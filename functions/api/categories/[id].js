// functions/api/categories/[id].js
import { isAdminAuthenticated, errorResponse, jsonResponse, normalizeSortOrder, clearHomeCache } from '../../_middleware';

export async function onRequestPut(context) {
  const { request, env, params } = context;
  const categoryId = decodeURIComponent(params.id);

  if (!(await isAdminAuthenticated(request, env))) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    const body = await request.json();

    if (!categoryId) {
      return errorResponse('Category id is required', 400);
    }

    if (body && body.reset) {
      // 1. Check for sub-categories
      const hasChildren = await env.NAV_DB.prepare('SELECT id FROM category WHERE parent_id = ? LIMIT 1')
        .bind(categoryId)
        .first();

      if (hasChildren) {
        return errorResponse('无法删除：该分类包含子分类，请先删除或移动子分类', 400);
      }

      // 2. Check for associated sites (bookmarks)
      const hasSites = await env.NAV_DB.prepare('SELECT id FROM sites WHERE catelog_id = ? LIMIT 1')
        .bind(categoryId)
        .first();

      if (hasSites) {
        return errorResponse('无法删除：该分类包含书签，请先删除或移动书签', 400);
      }

      await env.NAV_DB.prepare('DELETE FROM category WHERE id = ?')
        .bind(categoryId)
        .run();

      // 删除分类后自动清除首页缓存
      await clearHomeCache(env);

      return jsonResponse({
        code: 200,
        message: 'Category deleted successfully'
      });
    }

    const { catelog } = body;
    let { sort_order } = body;

    if (!catelog) {
      return errorResponse('Category name is required', 400);
    }

    const parentId = body.parent_id !== undefined ? parseInt(body.parent_id, 10) : 0;

    // 检查在同一个父分类下，分类名称是否已存在（排除自身）
    const existingCategory = await env.NAV_DB.prepare('SELECT id FROM category WHERE catelog = ? AND parent_id = ? AND id != ?')
      .bind(catelog, parentId, categoryId)
      .first();

    if (existingCategory) {
      return errorResponse('该分类名称在当前父分类下已存在', 409);
    }

    sort_order = normalizeSortOrder(sort_order);
    const isPrivate = body.is_private ? 1 : 0;

    await env.NAV_DB.prepare('UPDATE category SET catelog = ?, sort_order = ?, parent_id = ?, is_private = ? WHERE id = ?')
      .bind(catelog, sort_order, parentId, isPrivate, categoryId)
      .run();

    // Sync update sites table redundant column
    await env.NAV_DB.prepare('UPDATE sites SET catelog_name = ? WHERE catelog_id = ?')
      .bind(catelog, categoryId)
      .run();

    // If category is set to private, force all sites in this category to be private
    if (isPrivate === 1) {
      await env.NAV_DB.prepare('UPDATE sites SET is_private = 1 WHERE catelog_id = ?')
        .bind(categoryId)
        .run();
    }

    // 分类更新后自动清除首页缓存
    await clearHomeCache(env);

    return jsonResponse({
      code: 200,
      message: 'Category updated successfully'
    });

  } catch (e) {
    return errorResponse(`Failed to process category request: ${e.message}`, 500);
  }
}
