import { isAdminAuthenticated, errorResponse, jsonResponse, clearHomeCache } from '../../_middleware';

export async function onRequestPost(context) {
  const { request, env } = context;

  if (!(await isAdminAuthenticated(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const { action, ids, payload } = await request.json();

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return errorResponse('未提供 ID', 400);
    }

    // Cloudflare D1 限制单条语句变量数为 100。
    // 在更新操作中，除了 ID 列表（Chunk），还有 SET 部分的参数（如 catelog_id, catelog_name）。
    // 将分块大小设为 50 以确保变量总数绝对不会超过 100。
    const CHUNK_SIZE = 50;
    const chunks = [];
    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      chunks.push(ids.slice(i, i + CHUNK_SIZE));
    }

    const statements = [];

    if (action === 'delete') {
      chunks.forEach(chunk => {
        const placeholders = chunk.map(() => '?').join(',');
        statements.push(
          env.NAV_DB.prepare(`DELETE FROM sites WHERE id IN (${placeholders})`).bind(...chunk)
        );
      });

      await env.NAV_DB.batch(statements);

      // 批量删除后自动清除首页缓存
      await clearHomeCache(env);

      return jsonResponse({
        code: 200,
        message: `成功删除 ${ids.length} 条项目`
      });

    } else if (action === 'update_category') {
      const { categoryId } = payload;
      if (!categoryId) {
        return errorResponse('分类 ID 是必填项', 400);
      }

      const category = await env.NAV_DB.prepare('SELECT catelog, is_private FROM category WHERE id = ?').bind(categoryId).first();
      if (!category) {
        return errorResponse('找不到分类', 404);
      }

      let baseSql = `UPDATE sites SET catelog_id = ?, catelog_name = ?`;
      const baseParams = [categoryId, category.catelog];

      if (category.is_private === 1) {
        baseSql += `, is_private = 1`;
      }

      chunks.forEach(chunk => {
        const placeholders = chunk.map(() => '?').join(',');
        statements.push(
          env.NAV_DB.prepare(`${baseSql} WHERE id IN (${placeholders})`).bind(...baseParams, ...chunk)
        );
      });

      await env.NAV_DB.batch(statements);

      // 批量移分类后自动清除首页缓存
      await clearHomeCache(env);

      return jsonResponse({
        code: 200,
        message: `成功更新 ${ids.length} 条项目的分类`
      });

    } else if (action === 'update_privacy') {
      const { isPrivate } = payload;
      if (isPrivate === undefined) {
        return errorResponse('隐私状态是必填项', 400);
      }

      const isPrivateValue = isPrivate ? 1 : 0;

      chunks.forEach(chunk => {
        const placeholders = chunk.map(() => '?').join(',');
        statements.push(
          env.NAV_DB.prepare(`UPDATE sites SET is_private = ? WHERE id IN (${placeholders})`).bind(isPrivateValue, ...chunk)
        );
      });

      await env.NAV_DB.batch(statements);

      // 批量改私密后自动清除首页缓存
      await clearHomeCache(env);

      return jsonResponse({
        code: 200,
        message: `成功更新 ${ids.length} 条项目的隐私属性`
      });
    } else {
      return errorResponse('无效的操作', 400);
    }

  } catch (e) {
    return errorResponse(`批量操作失败: ${e.message}`, 500);
  }
}