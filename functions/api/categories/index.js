// functions/api/categories/index.js
import { isAdminAuthenticated, errorResponse, jsonResponse, normalizeSortOrder } from '../../_middleware';

let columnsChecked = false;

export async function onRequestGet(context) {
  const { request, env } = context;

  // 允许访客读取，但只返回公开分类（is_private=0）；Admin 可看全部
  const isAdmin = await isAdminAuthenticated(request, env);

  if (!columnsChecked) {
    try {
      await env.NAV_DB.prepare("SELECT parent_id FROM category LIMIT 1").first();
      try {
        await env.NAV_DB.prepare("SELECT is_private FROM category LIMIT 1").first();
      } catch (e) {
        await env.NAV_DB.prepare("ALTER TABLE category ADD COLUMN is_private INTEGER DEFAULT 0").run();
      }
      columnsChecked = true;
    } catch (e) {
      try {
        await env.NAV_DB.prepare("ALTER TABLE category ADD COLUMN parent_id INTEGER DEFAULT 0").run();
        await env.NAV_DB.prepare("ALTER TABLE category ADD COLUMN is_private INTEGER DEFAULT 0").run();
        columnsChecked = true;
      } catch (e2) {
        console.error("Failed to add columns", e2);
      }
    }
  }

  const url = new URL(request.url);
  const page = parseInt(url.searchParams.get('page') || '1', 10);
  const pageSize = parseInt(url.searchParams.get('pageSize') || '10', 10);
  const offset = (page - 1) * pageSize;

  try {
    // 访客只能看公开分类，Admin 看全部
    const privateFilter = isAdmin ? '' : 'WHERE c.is_private = 0';
    const countFilter = isAdmin ? '' : 'WHERE is_private = 0';

    const { results } = await env.NAV_DB.prepare(`
        SELECT c.id, c.catelog, c.sort_order, c.parent_id, c.is_private, COUNT(s.id) AS site_count
        FROM category c
        LEFT JOIN sites s ON c.id = s.catelog_id
        ${privateFilter}
        GROUP BY c.id, c.catelog, c.sort_order, c.parent_id
        ORDER BY c.sort_order ASC, c.create_time DESC
        LIMIT ? OFFSET ?
      `).bind(pageSize, offset).all();
    const countResult = await env.NAV_DB.prepare(`
      SELECT COUNT(*) as total FROM category ${countFilter}
    `).first();

    const total = countResult ? countResult.total : 0;

    return jsonResponse({
      code: 200,
      data: results,
      total,
      page,
      pageSize
    });
  } catch (e) {
    return errorResponse(`Failed to fetch categories: ${e.message}`, 500);
  }
}
