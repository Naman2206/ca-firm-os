targetScope = 'subscription'

@minLength(1)
@maxLength(64)
param environmentName string
@minLength(1)
param location string
param sessionId string
param deployedBy string
param createdAt string
param resourceGroupName string = 'ca-firm-prod-rg'
param deployerObjectId string = ''
param corsOrigins string = 'https://swa-ca-firm-os-admin-a6fc.azurestaticapps.net,https://swa-ca-firm-os-client-a6fc.azurestaticapps.net'

var tags = {
  'app-onboard-skill': 'true'
  'app-onboard-session-id': sessionId
  'created-at': createdAt
  environment: environmentName
  'deployed-by': deployedBy
}

resource rg 'Microsoft.Resources/resourceGroups@2023-07-01' existing = {
  name: resourceGroupName
}

module keyVault './modules/key-vault.bicep' = {
  name: 'key-vault'
  scope: rg
  params: {
    location: location
    keyVaultName: 'kv-ca-firm-os-prod-a6fc'
    tags: tags
  }
}

module appService './modules/app-service.bicep' = {
  name: 'platform-api'
  scope: rg
  params: {
    location: location
    appServicePlanName: 'asp-ca-firm-os-prod-a6fc'
    appServiceName: 'app-ca-firm-os-prod-a6fc'
    keyVaultName: keyVault.outputs.name
    corsOrigins: corsOrigins
    tags: tags
  }
}

module adminDashboard './modules/static-web-app.bicep' = {
  name: 'admin-dashboard'
  scope: rg
  params: {
    location: 'eastasia'
    staticWebAppName: 'swa-ca-firm-os-admin-a6fc'
    tags: tags
  }
}

module clientPortal './modules/static-web-app.bicep' = {
  name: 'client-portal'
  scope: rg
  params: {
    location: 'eastasia'
    staticWebAppName: 'swa-ca-firm-os-client-a6fc'
    tags: tags
  }
}

module roleAssignments './modules/role-assignments.bicep' = {
  name: 'role-assignments'
  scope: rg
  params: {
    keyVaultName: keyVault.outputs.name
    keyVaultResourceId: keyVault.outputs.resourceId
    appPrincipalId: appService.outputs.principalId
    deployerObjectId: deployerObjectId
  }
}

output resourceGroupName string = rg.name
output appServiceName string = appService.outputs.name
output appServiceDefaultHostName string = appService.outputs.defaultHostName
output adminDashboardDefaultHostName string = adminDashboard.outputs.defaultHostName
output clientPortalDefaultHostName string = clientPortal.outputs.defaultHostName
output keyVaultName string = keyVault.outputs.name