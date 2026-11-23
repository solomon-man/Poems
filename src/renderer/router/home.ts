const layoutRouter = [
  {
    path: '/',
    name: 'localMusic',
    meta: {
      title: 'comp.localMusic',
      icon: 'ri-folder-music-fill',
      keepAlive: true,
      isMobile: true,
      electronOnly: false,
      hideInSidebar: false
    },
    component: () => import('@/views/local-music/index.vue')
  },
  {
    path: '/hymn-library',
    name: 'hymnLibrary',
    meta: {
      title: 'comp.hymnLibrary',
      icon: 'ri-book-open-fill',
      keepAlive: true,
      isMobile: false,
      electronOnly: false,
      hideInSidebar: false
    },
    component: () => import('@/views/hymn-library/index.vue')
  },
  {
    path: '/history',
    name: 'history',
    component: () => import('@/views/historyAndFavorite/index.vue'),
    meta: {
      title: 'comp.history',
      icon: 'ri-history-line',
      keepAlive: true,
      isMobile: true,
      electronOnly: false,
      hideInSidebar: false
    }
  },
  {
    path: '/favorite',
    name: 'favorite',
    meta: {
      title: 'comp.favorite',
      icon: 'ri-heart-3-fill',
      keepAlive: true,
      isMobile: true,
      electronOnly: false,
      hideInSidebar: false
    },
    component: () => import('@/views/favorite/index.vue')
  },
  {
    path: '/set',
    name: 'set',
    meta: {
      title: 'comp.settings',
      icon: 'ri-settings-3-fill',
      keepAlive: true,
      noScroll: true,
      back: false,
      isMobile: true,
      electronOnly: false,
      hideInSidebar: false
    },
    component: () => import('@/views/set/index.vue')
  }
];
export default layoutRouter;
