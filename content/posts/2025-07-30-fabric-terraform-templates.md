---
title: How to use templating in Terraform to spin up Fabric resources
author: thibauldc
date: 2025-07-30 17:00:00
categories: [Infrastructure As Code, Terraform]
tags: [microsoft, fabric, terraform, IaC]
---
The Terraform provider for Microsoft Fabric provides a convenient way to spin up resources in Microsoft Fabric. For a lot of resources you can provide an item definition to set some extra configurations when spinning up the resource.

## Example: Deploying a Mirrored Database

Consider deploying a mirrored database using Terraform. You want to include all necessary details directly in your Terraform code. According to the [provider documentation](https://registry.terraform.io/providers/microsoft/fabric/latest/docs/resources/mirrored_database), here's an example configuration:

```terraform
resource "fabric_mirrored_database" "example_definition_bootstrap" {
  display_name              = "example2"
  description               = "example with definition bootstrapping"
  workspace_id              = "00000000-0000-0000-0000-000000000000"
  definition_update_enabled = false
  format                    = "Default"
  definition = {
    "mirroring.json" = {
      source = "${local.path}/mirroring.json.tmpl"
    }
  }
}
```

While this example is helpful, it lacks details on structuring the .tmpl file. The [Microsoft Learn page](https://learn.microsoft.com/en-gb/rest/api/fabric/articles/item-management/definitions/mirrored-database-definition) provides some guidance on what to include in the definition. However, you might want to make this definition dynamic to adapt to different environments.

## Dynamic definition implementation

Here's how you can implement a dynamic definition for a mirrored Azure SQL database in Terraform, assuming you have already defined a workspace and a connection to the Azure SQL Database in Microsoft Fabric:


`fabric.tf`
```terraform
resource "fabric_mirrored_database" "mirror" {
  display_name = "mirror${var.environment}"
  workspace_id = fabric_workspace.workspace.id
  definition_update_enabled = false
  format = "Default"
  definition = {
    "mirroring.json" = {
      source = "${local.path}/mirror.json.tmpl"
      tokens = {
        "mirror_connection_id" = var.mirror_connection_id
        "db_name" = "dbname${var.environment}"
      }
    }
  }
}
```

`locals.tf`
```terraform
locals {
  path = "${path.module}/templates"
}
```

`variables.tf`
```terraform
variable "environment" {
  type        = string
  description = "The name of the environment (dev, tst, prd, etc.)"
}

variable "mirror_connection_id" {
  description = "SQL database connection id in Fabric"
  type        = string
}
```

`templates/mirror.json.tmpl`
```json
{
    "properties": {
        "source": {
            "type": "AzureSqlDatabase",
            "typeProperties": {
                "connection": "{{.mirror_connection_id}}",
                "database": "{{.db_name}}"
            }
        },
        "target": {
            "type": "MountedRelationalDatabase",
            "typeProperties": {
                "defaultSchema": "dbo",
                "format": "Delta"
            }
        },
        "mountedTables": [
        {
            "source": {
                "typeProperties": {
                    "schemaName": "schema1",
                    "tableName": "table1"
                }
            }
        },
        {
            "source": {
            "typeProperties": {
                "schemaName": "schema1",
                "tableName": "table2"
            }
            }
        }
        ]
    }
}
```

The folder structure should look something like this:
```
.
├── fabric.tf
├── locals.tf
├── provider.tf
├── templates
│   └── mirror.json.tmpl
└── variables.tf
```

In this setup, variables are injected into the template, allowing the correct resource to be deployed based on the specified environment.
