"""
Django settings for labelPlantform project.

For more information on this file, see
https://docs.djangoproject.com/en/4.0/topics/settings/

For the full list of settings and their values, see
https://docs.djangoproject.com/en/4.0/ref/settings/
"""

import os
import environ
from pathlib import Path

# Initialize environment variables
env = environ.Env(
    DEBUG=(bool, False),
    ALLOWED_HOSTS=(list, []),
)

BASE_DIR = Path(__file__).resolve().parent.parent

# Read .env file if it exists
environ.Env.read_env(os.path.join(BASE_DIR, '.env'))

# ========================
# 基础安全配置
# ========================
SECRET_KEY = env('SECRET_KEY', default='django-insecure-development-key-change-in-production')
DEBUG = env('DEBUG', default=True)
ALLOWED_HOSTS = env('ALLOWED_HOSTS', default=['127.0.0.1', 'localhost'])

# ========================
# 应用配置
# ========================
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'user',
    'label',
    'axes',   # ✅ 登录防爆破
]

AUTH_USER_MODEL = 'user.User'  # 使用自定义模型

MIDDLEWARE = [
    'axes.middleware.AxesMiddleware',    # ✅ Axes 必须放最前
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'labelPlantform.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [
            BASE_DIR / 'templates',
            BASE_DIR / 'labelme',
        ],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'labelPlantform.wsgi.application'

# ========================
# 数据库
# ========================
DATABASES = {
    'default': {
        'ENGINE': env('DB_ENGINE', default='django.db.backends.sqlite3'),
        'NAME': env('DB_NAME', default=os.path.join(BASE_DIR, 'db.sqlite3')),
        'USER': env('DB_USER', default='annotation_user'),
        'PASSWORD': env('DB_PASSWORD', default='123456'),
        'HOST': env('DB_HOST', default='localhost'),
        'PORT': env('DB_PORT', default='5432'),
    }
}

# ========================
# 密码安全
# ========================
AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

# ========================
# 国际化
# ========================
LANGUAGE_CODE = 'zh-hans'
TIME_ZONE = 'Asia/Shanghai'
USE_I18N = True
USE_TZ = True

# ========================
# 静态 & 媒体
# ========================
STATIC_URL = '/static/'
STATICFILES_DIRS = [BASE_DIR / 'static']
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')  # 生产环境 collectstatic 用

MEDIA_URL = '/media/'
MEDIA_ROOT = os.path.join(BASE_DIR, 'media')

# ========================
# Django-Axes 防爆破配置
# ========================
AUTHENTICATION_BACKENDS = [
    'axes.backends.AxesStandaloneBackend',     # ✅ Axes 先检查
    'django.contrib.auth.backends.ModelBackend',  # ✅ Django 默认认证
]

AXES_ENABLED = False


AXES_FAILURE_LIMIT = 5       # 连续 5 次失败锁定
AXES_COOLOFF_TIME = 1        # 1 小时后自动解锁

AXES_LOCKOUT_PARAMETERS = ['username', 'ip_address']

# ✅ 删除 AXES_LOCKOUT_CALLABLE 避免无效警告（用默认锁定响应）
# AXES_LOCKOUT_CALLABLE = 'axes.utils.default_lockout_response'

# ========================
# 登录配置
# ========================
LOGIN_URL = '/login/'  # 未登录时自动跳转登录页

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
