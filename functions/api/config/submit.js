// functions/api/config/submit.js
import { isSubmissionEnabled, errorResponse, jsonResponse, checkRateLimit } from '../../_middleware';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!isSubmissionEnabled(env)) {
    return errorResponse('Public submission disabled', 403);
  }

  // 基于 IP 的速率限制：每 IP 每分钟最多 5 次提交
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  const { allowed } = await checkRateLimit(env, `submit_rate_${ip}`, 5, 60);
  if (!allowed) {
    return errorResponse('提交过于频繁，请稍后再试', 429);
  }

  try {
    const config = await request.json();
    const { name, url, logo, desc, catelog_id } = config;

    const sanitizedName = (name || '').trim();
    const sanitizedUrl = (url || '').trim();
    let sanitizedLogo = (logo || '').trim() || null;
    const sanitizedDesc = (desc || '').trim() || null;

    if (!sanitizedName || !sanitizedUrl || !catelog_id) {
      return errorResponse('Name, URL and Category are required', 400);
    }

    // 访客未提供 logo 时自动生成（与管理员新增逻辑对齐）
    if (!sanitizedLogo && sanitizedUrl) {
      const iconAPI = env.ICON_API || 'https://faviconsnap.com/api/favicon?url=';
      if (sanitizedUrl.startsWith('https://') || sanitizedUrl.startsWith('http://')) {
        const domain = sanitizedUrl.replace(/^https?:\/\//, '').split('/')[0];
        sanitizedLogo = iconAPI + domain;
      }
    }

    const categoryResult = await env.NAV_DB.prepare('SELECT catelog, is_private FROM category WHERE id = ?').bind(catelog_id).first();
    const catelogName = categoryResult ? categoryResult.catelog : 'Unknown';
    // If category is private, we might want to flag it? But pending_sites doesn't have is_private.
    // However, since public users can't see private categories (filtered in index.js), they likely can't submit to one.
    // If they manually forge a request, well, it goes to pending.
    // When admin approves, admin will decide.
    // So maybe submit.js doesn't need changes if pending_sites doesn't have is_private.
    // But let's check functions/api/config/index.js which Admin uses.

    await env.NAV_DB.prepare(`
      INSERT INTO pending_sites (name, url, logo, desc, catelog_id, catelog_name)
      VALUES (?, ?, ?, ?, ?, ?)
    `).bind(sanitizedName, sanitizedUrl, sanitizedLogo, sanitizedDesc, catelog_id, catelogName).run();

    return jsonResponse({
      code: 201,
      message: 'Config submitted successfully, waiting for admin approve',
    }, 201);
  } catch (e) {
    return errorResponse(`Failed to submit config: ${e.message}`, 500);
  }
}
