"""
Demo data creation script for LabelPlantform

This script creates sample data to help users quickly understand and test
the functionality of the LabelPlantform application.
"""

import os
import sys
import django
from django.contrib.auth import get_user_model
from django.core.files.base import ContentFile
from label.models import TaskPackage, Organization
from user.models import RoleInOrganization

# Setup Django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'labelPlantform.settings')
django.setup()

User = get_user_model()


def create_demo_data():
    print("Creating demo data for LabelPlantform...")
    
    # Create organizations
    print("Creating organizations...")
    org1, created = Organization.objects.get_or_create(
        name="Acme Corp",
        defaults={'code': 'ACME'}
    )
    org2, created = Organization.objects.get_or_create(
        name="Tech Innovations",
        defaults={'code': 'TECH'}
    )
    
    # Create users
    print("Creating users...")
    
    # Platform admin
    platform_admin, created = User.objects.get_or_create(
        username='admin',
        defaults={
            'email': 'admin@example.com',
            'is_staff': True,
            'is_superuser': True,
            'is_active': True,
            'is_platform_admin': True
        }
    )
    if created:
        platform_admin.set_password('admin123')
        platform_admin.save()
        print("  Created platform admin: admin / admin123")
    
    # Organization admins
    org_admin1, created = User.objects.get_or_create(
        username='acme_admin',
        defaults={
            'email': 'admin@acme.com',
            'is_active': True,
            'is_org_admin': True,
            'organization': org1
        }
    )
    if created:
        org_admin1.set_password('acme123')
        org_admin1.save()
        print("  Created ACME admin: acme_admin / acme123")
    
    org_admin2, created = User.objects.get_or_create(
        username='tech_admin',
        defaults={
            'email': 'admin@tech.com',
            'is_active': True,
            'is_org_admin': True,
            'organization': org2
        }
    )
    if created:
        org_admin2.set_password('tech123')
        org_admin2.save()
        print("  Created Tech admin: tech_admin / tech123")
    
    # Regular users
    annotator1, created = User.objects.get_or_create(
        username='john_annotator',
        defaults={
            'email': 'john@acme.com',
            'is_active': True,
            'organization': org1
        }
    )
    if created:
        annotator1.set_password('john123')
        annotator1.save()
        # Assign role
        RoleInOrganization.objects.get_or_create(
            user=annotator1,
            organization=org1,
            role='annotator'
        )
        print("  Created annotator: john_annotator / john123")
    
    reviewer1, created = User.objects.get_or_create(
        username='sarah_reviewer',
        defaults={
            'email': 'sarah@acme.com',
            'is_active': True,
            'organization': org1
        }
    )
    if created:
        reviewer1.set_password('sarah123')
        reviewer1.save()
        # Assign role
        RoleInOrganization.objects.get_or_create(
            user=reviewer1,
            organization=org1,
            role='reviewer'
        )
        print("  Created reviewer: sarah_reviewer / sarah123")
    
    client1, created = User.objects.get_or_create(
        username='client_user',
        defaults={
            'email': 'client@example.com',
            'is_active': True,
            'is_client': True
        }
    )
    if created:
        client1.set_password('client123')
        client1.save()
        print("  Created client: client_user / client123")
    
    # Create sample task packages
    print("Creating sample task packages...")
    
    # Sample task package
    task_pkg, created = TaskPackage.objects.get_or_create(
        name="Sample Building Annotations",
        defaults={
            'save_format': 'json',
            'labels': 'building,window,door,roof',
            'created_by': platform_admin
        }
    )
    if created:
        print("  Created sample task package: Sample Building Annotations")
    
    task_pkg2, created = TaskPackage.objects.get_or_create(
        name="Vehicle Detection Dataset",
        defaults={
            'save_format': 'json',
            'labels': 'car,truck,bus,motorcycle,bicycle',
            'created_by': platform_admin
        }
    )
    if created:
        print("  Created sample task package: Vehicle Detection Dataset")
    
    # Assign task packages to organizations
    task_pkg.allowed_organization = org1
    task_pkg.save()
    
    task_pkg2.allowed_organization = org2
    task_pkg2.save()
    
    print("\nDemo data creation completed!")
    print("\nLogin credentials:")
    print("- Platform Admin: admin / admin123")
    print("- ACME Org Admin: acme_admin / acme123")
    print("- Tech Org Admin: tech_admin / tech123")
    print("- Annotator: john_annotator / john123")
    print("- Reviewer: sarah_reviewer / sarah123")
    print("- Client: client_user / client123")
    print("\nTo run the application: python manage.py runserver")


if __name__ == '__main__':
    create_demo_data()