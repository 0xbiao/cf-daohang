// functions/api/config/import.js
import { isAdminAuthenticated, errorResponse, jsonResponse, normalizeSortOrder, clearHomeCache } from '../../_middleware';

/**
 * 解析 Chrome 导出的 Bookmarks HTML 文件
 * 格式：<!DOCTYPE NETSCAPE-Bookmark-file-1> ... <DT><H3>Folder</H3><DL>...<DT><A HREF="...">Name</A>...
 * @param {string} html - HTML 字符串
 * @returns {{ category: Array, sites: Array }}
 */
function parseChromeBookmarksHtml(html) {
    const categories = [];
    const sites = [];
    let catIdCounter = 1;

    // 递归解析 <DL> 块
    function parseDL(segment, parentId) {
        // 匹配文件夹 <DT><H3...>name</H3> 后跟 <DL>...</DL>
        const folderRegex = /<DT><H3[^>]*>([^<]+)<\/H3>\s*(?:<DD>[^<]*<\/DD>\s*)?<DL><p>([\s\S]*?)<\/DL><p>/gi;
        // 匹配书签 <DT><A HREF="..." ...>name</A>
        const linkRegex = /<DT><A\s+HREF="([^"]*)"[^>]*>([^<]*)<\/A>/gi;

        // 先找出所有直接子文件夹（使用占位符避免嵌套干扰）
        const folderMatches = [];
        let m;

        // 替换嵌套 DL 为占位符以避免贪婪匹配问题（简单解析方案）
        // 通过按序扫描方式处理
        let pos = 0;
        const text = segment;

        while (pos < text.length) {
            // 寻找下一个 <DT>
            const dtIdx = text.indexOf('<DT>', pos);
            if (dtIdx === -1) break;

            // 判断是 H3（文件夹）还是 A（书签）
            const afterDt = text.slice(dtIdx + 4).trimStart();

            if (afterDt.startsWith('<H3')) {
                // 文件夹：找到 H3 结束，再找对应的 <DL>
                const h3End = text.indexOf('</H3>', dtIdx);
                if (h3End === -1) { pos = dtIdx + 4; continue; }
                const folderName = text.slice(text.indexOf('>', dtIdx + 4) + 1, h3End).trim();

                // 跳过可能存在的 <DD>
                let dlStart = text.indexOf('<DL>', h3End);
                if (dlStart === -1) { pos = h3End + 5; continue; }

                // 找到匹配的 </DL>（计数嵌套层级）
                let depth = 1;
                let scanPos = dlStart + 4;
                while (depth > 0 && scanPos < text.length) {
                    const openIdx = text.indexOf('<DL>', scanPos);
                    const closeIdx = text.indexOf('</DL>', scanPos);
                    if (closeIdx === -1) break;
                    if (openIdx !== -1 && openIdx < closeIdx) {
                        depth++;
                        scanPos = openIdx + 4;
                    } else {
                        depth--;
                        scanPos = closeIdx + 5;
                    }
                }
                const dlEnd = scanPos - 5; // 最后一个 </DL> 的位置
                const innerContent = text.slice(dlStart + 4, dlEnd);

                const catId = catIdCounter++;
                categories.push({
                    id: catId,
                    catelog: folderName || '未命名分类',
                    sort_order: 9999,
                    parent_id: parentId,
                    is_private: 0,
                });

                // 递归解析子内容
                parseDL(innerContent, catId);
                pos = scanPos;

            } else if (afterDt.startsWith('<A ')) {
                // 书签：找 A 的 HREF 和文字
                const aStart = text.indexOf('<A ', dtIdx);
                const hrefMatch = text.slice(aStart).match(/HREF="([^"]*)"/i);
                const aEnd = text.indexOf('</A>', aStart);
                const nameMatch = aEnd !== -1 ? text.slice(text.indexOf('>', aStart) + 1, aEnd).trim() : '';

                if (hrefMatch && nameMatch) {
                    sites.push({
                        name: nameMatch,
                        url: hrefMatch[1],
                        logo: '',
                        desc: '',
                        catelog_id: parentId || 0,
                        sort_order: 9999,
                        is_private: 0,
                    });
                }
                pos = aEnd !== -1 ? aEnd + 4 : dtIdx + 4;
            } else {
                pos = dtIdx + 4;
            }
        }
    }

    // 从顶层 <DL> 开始解析
    const topDlMatch = html.match(/<DL><p>([\s\S]*)/i);
    if (topDlMatch) {
        parseDL(topDlMatch[1], 0);
    }

    return { category: categories, sites };
}

export async function onRequestPost(context) {
    const { request, env } = context;

    if (!(await isAdminAuthenticated(request, env))) {
        return errorResponse('Unauthorized', 401);
    }

    try {
        // 检测是否为 Chrome Bookmarks HTML 格式
        const contentType = request.headers.get('Content-Type') || '';
        let jsonData;

        if (contentType.includes('text/html') || contentType.includes('text/plain')) {
            // Chrome HTML 格式：解析后转换为内部 JSON 格式
            const htmlText = await request.text();
            if (!htmlText.trim().toUpperCase().includes('NETSCAPE-BOOKMARK')) {
                return errorResponse('不是有效的 Chrome 书签 HTML 文件', 400);
            }
            const parsed = parseChromeBookmarksHtml(htmlText);
            jsonData = { category: parsed.category, sites: parsed.sites, override: false };
        } else {
            jsonData = await request.json();
        }


        let categoriesToImport = [];
        let sitesToImport = [];
        let isNewFormat = false;
        // 获取 override 参数，默认 false
        const override = !!jsonData.override;

        // Detect import format
        // Handle the wrapper payload if it exists (due to frontend change passing { ...data, override })
        let payload = jsonData;
        if (jsonData.category && jsonData.sites && (jsonData.override !== undefined || Object.keys(jsonData).length > 2)) {
            // It's the new payload wrapper
            payload = jsonData;
        } else if (jsonData.category && jsonData.sites) {
            // Direct export format
            payload = jsonData;
        }

        if (payload && typeof payload === 'object' && Array.isArray(payload.category) && Array.isArray(payload.sites)) {
            categoriesToImport = payload.category;
            sitesToImport = payload.sites;
            isNewFormat = true;
        } else if (Array.isArray(jsonData)) { // Legacy format support (raw array)
            sitesToImport = jsonData;
        } else {
            return errorResponse('Invalid JSON format. Expected { "category": [...], "sites": [...] } or an array of sites.', 400);
        }

        if (sitesToImport.length === 0) {
            return jsonResponse({ code: 200, message: 'Import successful, but no sites were found to import.' });
        }

        const db = env.NAV_DB;
        // Cloudflare D1 限制单条语句变量数为 100。
        // 在导入过程中的 SELECT ... WHERE IN (...) 查询中，
        // 将分块大小设为 50 以确保绝对安全且不影响效率。
        const BATCH_SIZE = 50;

        // --- Category Processing ---
        const oldCatIdToNewCatIdMap = new Map(); // Maps JSON ID -> DB ID
        let categoryNameToIdMap = new Map(); // For legacy format mapping

        // 1. Fetch all existing categories from DB
        const { results: existingDbCategoriesRaw } = await db.prepare('SELECT id, catelog, parent_id, is_private FROM category').all();
        const existingDbCategories = existingDbCategoriesRaw || [];

        // Helper to find existing category by name and parent_id
        const findExistingCategory = (name, parentId) => {
            const normalizedParentId = (parentId === null || parentId === undefined) ? 0 : parseInt(parentId, 10);
            return existingDbCategories.find(c => {
                const dbParentId = (c.parent_id === null || c.parent_id === undefined) ? 0 : parseInt(c.parent_id, 10);
                return c.catelog === name && dbParentId === normalizedParentId;
            });
        };

        if (isNewFormat) {
            // Validate all categories first
            for (const cat of categoriesToImport) {
                if (!cat.catelog || !(cat.catelog.trim())) {
                    return errorResponse("导入失败：分类数据中存在无效条目，缺少 'catelog' 名称。", 400);
                }
            }

            // Sort categories to ensure parents are processed before children (Topological Sort)
            let sortedCats = [];
            let remaining = [...categoriesToImport];
            let processedJsonIds = new Set([0, '0']);

            let lastRemainingCount = -1;
            while (remaining.length > 0) {
                if (remaining.length === lastRemainingCount) {
                    sortedCats.push(...remaining);
                    break;
                }
                lastRemainingCount = remaining.length;

                const [ready, notReady] = remaining.reduce((acc, cat) => {
                    const pid = cat.parent_id || 0;
                    if (processedJsonIds.has(pid)) {
                        acc[0].push(cat);
                    } else {
                        acc[1].push(cat);
                    }
                    return acc;
                }, [[], []]);

                ready.sort((a, b) => (a.id || 0) - (b.id || 0));
                ready.forEach(cat => processedJsonIds.add(cat.id));
                sortedCats.push(...ready);
                remaining = notReady;
            }
            categoriesToImport = sortedCats;

            for (const cat of categoriesToImport) {
                const catName = (cat.catelog || '').trim();
                const jsonParentId = cat.parent_id || 0;
                const isPrivate = cat.is_private ? 1 : 0; // Import privacy setting

                let dbParentId = 0;
                if (jsonParentId !== 0) {
                    if (oldCatIdToNewCatIdMap.has(jsonParentId)) {
                        dbParentId = oldCatIdToNewCatIdMap.get(jsonParentId);
                    } else {
                        dbParentId = 0;
                    }
                }

                const existing = findExistingCategory(catName, dbParentId);

                if (existing) {
                    oldCatIdToNewCatIdMap.set(cat.id, existing.id);
                } else {
                    const sortOrder = normalizeSortOrder(cat.sort_order);
                    const result = await db.prepare('INSERT INTO category (catelog, sort_order, parent_id, is_private) VALUES (?, ?, ?, ?)')
                        .bind(catName, sortOrder, dbParentId, isPrivate)
                        .run();
                    let newId = result.meta.last_row_id;

                    const newCatObj = { id: newId, catelog: catName, parent_id: dbParentId, is_private: isPrivate };
                    if (!existingDbCategories) {
                        // existingDbCategories = [newCatObj]; 
                    } else {
                        existingDbCategories.push(newCatObj);
                    }

                    oldCatIdToNewCatIdMap.set(cat.id, newId);
                }
            }
        } else {
            if (existingDbCategories) {
                existingDbCategories.forEach(c => categoryNameToIdMap.set(c.catelog, c.id));
            }
            const defaultCategory = 'Default';
            const categoryNames = [...new Set(sitesToImport.map(item => (item.catelog || defaultCategory).trim()))].filter(name => name);
            const newCategoryNames = categoryNames.filter(name => !categoryNameToIdMap.has(name));

            if (newCategoryNames.length > 0) {
                // Legacy import doesn't have is_private info, defaults to 0
                const insertStmts = newCategoryNames.map(name => db.prepare('INSERT INTO category (catelog, is_private) VALUES (?, 0)').bind(name));
                await db.batch(insertStmts);

                for (let i = 0; i < newCategoryNames.length; i += BATCH_SIZE) {
                    const chunk = newCategoryNames.slice(i, i + BATCH_SIZE);
                    const placeholders = chunk.map(() => '?').join(',');
                    const { results: newCategories } = await db.prepare(`SELECT id, catelog, is_private FROM category WHERE catelog IN (${placeholders})`).bind(...chunk).all();
                    if (newCategories) {
                        newCategories.forEach(c => {
                            categoryNameToIdMap.set(c.catelog, c.id);
                            existingDbCategories.push(c); // Update local cache
                        });
                    }
                }
            }
        }

        // --- Site Processing ---
        const siteUrls = sitesToImport.map(item => (item.url || '').trim()).filter(url => url);
        const existingSiteUrls = new Set();
        if (siteUrls.length > 0) {
            for (let i = 0; i < siteUrls.length; i += BATCH_SIZE) {
                const chunk = siteUrls.slice(i, i + BATCH_SIZE);
                const placeholders = chunk.map(() => '?').join(',');
                const { results: existingSites } = await db.prepare(`SELECT url FROM sites WHERE url IN (${placeholders})`).bind(...chunk).all();
                if (existingSites) {
                    existingSites.forEach(site => existingSiteUrls.add(site.url));
                }
            }
        }

        const batchStmts = [];
        let itemsAdded = 0;
        let itemsUpdated = 0;
        let itemsSkipped = 0;
        const iconAPI = env.ICON_API || 'https://faviconsnap.com/api/favicon?url=';

        for (const site of sitesToImport) {
            const sanitizedUrl = (site.url || '').trim();
            const sanitizedName = (site.name || '').trim();

            if (!sanitizedUrl || !sanitizedName) {
                itemsSkipped++;
                continue;
            }
            if (isNewFormat && (site.catelog_id === undefined || site.catelog_id === null)) {
                itemsSkipped++;
                continue;
            }

            const exists = existingSiteUrls.has(sanitizedUrl);
            if (exists && !override) {
                itemsSkipped++;
                continue;
            }

            let newCatId;
            let catNameForDb;
            let catIsPrivate = 0;

            if (isNewFormat) {
                newCatId = oldCatIdToNewCatIdMap.get(site.catelog_id);
                const catObj = existingDbCategories.find(c => c.id === newCatId);
                if (catObj) {
                    catNameForDb = catObj.catelog;
                    catIsPrivate = catObj.is_private || 0;
                }
            } else {
                const catName = (site.catelog || 'Default').trim();
                newCatId = categoryNameToIdMap.get(catName);
                catNameForDb = catName;
                const catObj = existingDbCategories.find(c => c.id === newCatId);
                if (catObj) {
                    catIsPrivate = catObj.is_private || 0;
                }
            }

            if (!newCatId) {
                itemsSkipped++;
                continue;
            }

            let sanitizedLogo = (site.logo || '').trim();
            if ((!sanitizedLogo || sanitizedLogo.startsWith('data:image')) && sanitizedUrl.startsWith('http')) {
                const domain = sanitizedUrl.replace(/^https?:\/\//, '').split('/')[0];
                sanitizedLogo = `${iconAPI}${domain}`;
            }
            if (!sanitizedLogo) sanitizedLogo = null;

            const sanitizedDesc = (site.desc || '').trim() || null;
            const sortOrderValue = normalizeSortOrder(site.sort_order);

            // Handle Privacy Logic
            let finalIsPrivate = site.is_private ? 1 : 0;
            // Force private if category is private
            if (catIsPrivate === 1) {
                finalIsPrivate = 1;
            }

            if (exists && override) {
                // Update
                batchStmts.push(
                    db.prepare('UPDATE sites SET name=?, logo=?, desc=?, catelog_id=?, catelog_name=?, sort_order=?, is_private=?, update_time=CURRENT_TIMESTAMP WHERE url=?')
                        .bind(sanitizedName, sanitizedLogo, sanitizedDesc, newCatId, catNameForDb, sortOrderValue, finalIsPrivate, sanitizedUrl)
                );
                itemsUpdated++;
            } else {
                // Insert
                batchStmts.push(
                    db.prepare('INSERT INTO sites (name, url, logo, desc, catelog_id, catelog_name, sort_order, is_private) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                        .bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, newCatId, catNameForDb, sortOrderValue, finalIsPrivate)
                );
                itemsAdded++;
            }
        }

        if (batchStmts.length > 0) {
            // Execute in batches to respect D1 limits
            for (let i = 0; i < batchStmts.length; i += BATCH_SIZE) {
                const chunk = batchStmts.slice(i, i + BATCH_SIZE);
                await db.batch(chunk);
            }
        }

        let msg = `导入完成。`;
        if (itemsAdded > 0) msg += ` 新增 ${itemsAdded} 个`;
        if (itemsUpdated > 0) msg += ` 更新 ${itemsUpdated} 个`;
        if (itemsSkipped > 0) msg += ` 跳过 ${itemsSkipped} 个`;

        // 导入后自动清除首页缓存
        await clearHomeCache(env);

        return jsonResponse({
            code: 201,
            message: msg
        }, 201);

    } catch (error) {
        return errorResponse(`Failed to import config: ${error.message}`, 500);
    }
}