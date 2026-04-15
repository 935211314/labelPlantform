# LabelPlantform

一个基于Django构建的综合性图像标注平台，专为管理标注任务、质量控制以及标注员、质检员和客户之间的协作而设计。

## 🌟 功能特性

- **多角色系统**: 平台管理员、组织管理员、标注员、质检员和客户
- **灵活的标注格式**: 支持JSON (LabelMe)、XML (Pascal VOC) 和 TXT (YOLO) 格式
- **质量控制**: 专用的质检工作流程，确保标注质量
- **组织管理**: 基于组织的多租户访问控制系统
- **客户审核**: 客户端审核和批准标注结果
- **进度跟踪**: 实时监控所有任务的进度
- **响应式UI**: 现代化、直观的界面，采用柔和的配色方案

## 🚀 快速开始

### 系统要求
- Python 3.8+
- PostgreSQL (或开发用SQLite)

### 安装步骤

1. 克隆仓库:
```bash
git clone https://github.com/yourusername/labelPlantform.git
cd labelPlantform
```

2. 创建虚拟环境:
```bash
python -m venv venv
source venv/bin/activate  # Windows系统: venv\Scripts\activate
```

3. 安装依赖:
```bash
pip install -r requirements.txt
```

4. 配置数据库 (根据需要更新 `settings.py`):
```bash
python manage.py migrate
```

5. 创建超级用户:
```bash
python manage.py createsuperuser
```

6. 启动开发服务器:
```bash
python manage.py runserver
```

## 📋 项目结构

```
labelPlantform/
├── label/                 # 核心标注功能
│   ├── models.py          # 数据库模型
│   ├── views.py           # 业务逻辑
│   └── urls.py            # URL路由
├── user/                  # 用户管理
│   ├── models.py          # 用户和组织模型
│   ├── views.py           # 认证和管理
│   └── urls.py            # 用户相关路由
├── templates/             # HTML模板
├── static/                # 静态资源 (CSS, JS, 图像)
└── media/                 # 上传的文件
```

## 🔐 用户角色

- **平台管理员**: 完全系统访问权限，管理组织
- **组织管理员**: 管理组织成员和任务
- **标注员**: 执行图像标注任务
- **质检员**: 质量控制和验证
- **客户**: 审核和批准完成的标注

## 📊 工作流程

1. 平台管理员上传任务包
2. 组织管理员分配任务给标注员
3. 标注员完成图像标注
4. 质检员验证标注质量
5. 客户审核并批准最终结果

## 🤝 贡献

我们欢迎各种贡献！详情请参阅我们的[贡献指南](CONTRIBUTING.md)。

## 📄 许可证

该项目基于MIT许可证 - 详见[LICENSE](LICENSE)文件。

## 🙏 致谢

- 基于Django框架构建
- 受到ML社区中各种标注工具的启发
- 感谢所有帮助改进此平台的贡献者

---

⭐ 如果您觉得这个项目有用，请给我们一个star！您的支持激励我们继续开发。