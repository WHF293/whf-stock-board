import 'vue-router';

/** 路由元信息扩展：页面标题用于 MainLayout 头部展示 */
declare module 'vue-router' {
  interface RouteMeta {
    /** 页面标题（头部导航展示） */
    title?: string;
  }
}
