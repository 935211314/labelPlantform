from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    path('super-secret-admin-panel-98f21/', admin.site.urls),

    # 用户相关路由（原 home、login、register 等都集中到 user/urls.py 中了）
    path('', include('user.urls')),

    # 标注模块
    path('label/', include('label.urls')),
]

# 静态资源
urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
