# Getting Started with LabelPlantform

This guide will help you set up and start using LabelPlantform for your image annotation projects.

## Prerequisites

- Python 3.8 or higher
- PostgreSQL (recommended) or SQLite (for development)
- Git

## Installation

### 1. Clone the Repository
```bash
git clone https://github.com/yourusername/labelPlantform.git
cd labelPlantform
```

### 2. Set Up Virtual Environment
```bash
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
```

### 3. Install Dependencies
```bash
pip install -r requirements.txt
```

### 4. Configure Database
Update `labelPlantform/settings.py` with your database settings:

For PostgreSQL:
```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': 'your_db_name',
        'USER': 'your_db_user',
        'PASSWORD': 'your_db_password',
        'HOST': 'localhost',
        'PORT': '5432',
    }
}
```

For development with SQLite (default):
```python
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}
```

### 5. Run Migrations
```bash
python manage.py migrate
```

### 6. Create Superuser
```bash
python manage.py createsuperuser
```

### 7. Collect Static Files
```bash
python manage.py collectstatic
```

### 8. Start the Server
```bash
python manage.py runserver
```

## Initial Setup

### 1. Create Organizations
- Log in as superuser
- Navigate to "Manage Organizations" 
- Create organizations for your teams

### 2. Add Users
- Users can register themselves and join organizations
- Organization admins can approve join requests
- Assign roles (annotator, reviewer) as needed

### 3. Upload Task Packages
- Prepare a ZIP file containing images to annotate
- Go to "Upload Task Package" (admin only)
- Select save format (JSON, XML, or TXT)
- Optionally add labels for annotation

## Using the Annotation Interface

### For Annotators:
1. Go to "Available Task Packages" to claim a task
2. Click "Start Annotation" on your assigned task
3. Use the annotation tools to label objects in images
4. Save your progress regularly
5. Submit when complete

### For Reviewers:
1. Access "QC Available Packages" to claim quality control tasks
2. Review annotations for accuracy and completeness
3. Approve or reject annotations as needed

### For Clients:
1. View assigned tasks through the client portal
2. Review completed annotations
3. Approve or request revisions

## Configuration Options

### Custom Labels
You can define custom labels for specific annotation tasks:
1. When uploading a task package, add labels separated by commas
2. Or upload a JSON file with label definitions

### Annotation Formats
Support for multiple formats:
- JSON (LabelMe format)
- XML (Pascal VOC format) 
- TXT (YOLO format)

## Troubleshooting

### Common Issues:
- **Database errors**: Ensure your database is running and credentials are correct
- **Static files not loading**: Run `python manage.py collectstatic`
- **Permission errors**: Check user roles and organization assignments

### Need Help?
- Check the GitHub issues page
- Create a new issue for bugs or feature requests
- Refer to the documentation in the `/docs` folder

## Next Steps

- Explore advanced features in the documentation
- Customize the platform for your specific needs
- Contribute to the project on GitHub
- Join the community discussions