// functions/admin/index.js

async function validateAdminSession(request, env) {
  const cookie = request.headers.get('Cookie');
  if (!cookie) return { authenticated: false };

  const match = cookie.match(/admin_session=([^;]+)/);
  if (!match) return { authenticated: false };

  const token = match[1];
  const session = await env.NAV_AUTH.get(`session_${token}`);

  return session ? { authenticated: true, token } : { authenticated: false };
}

// GET: 显示管理页面或重定向到登录
export async function onRequestGet(context) {
  const { request, env } = context;

  const session = await validateAdminSession(request, env);

  if (!session.authenticated) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/admin/login',
      },
    });
  }

  // 尝试从静态资源读取 HTML 文件
  try {
    const url = new URL(request.url);
    url.pathname = '/admin/index.html';

    const response = await env.ASSETS.fetch(url);

    if (response.ok) {
      return response;
    } else {
      console.error('Failed to load admin HTML:', response.status);
      return new Response('管理页面加载失败', { status: 500 });
    }
  } catch (e) {
    console.error('Error loading admin page:', e);
    return new Response('管理页面加载失败: ' + e.message, { status: 500 });
  }
}
