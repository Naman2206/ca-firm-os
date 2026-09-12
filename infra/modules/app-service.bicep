param location string
param appServicePlanName string
param appServiceName string
param keyVaultName string
param corsOrigins string
param tags object

resource appServicePlan 'Microsoft.Web/serverfarms@2023-12-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    family: 'B'
    capacity: 1
  }
  properties: {
    reserved: true
  }
  tags: tags
}

resource appService 'Microsoft.Web/sites@2024-11-01' = {
  name: appServiceName
  location: location
  kind: 'app,linux'
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: appServicePlan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: 'NODE|20-lts'
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      healthCheckPath: '/healthz'
      appCommandLine: 'npm start'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '3000' }
        { name: 'ACCESS_TOKEN_TTL', value: '8h' }
        { name: 'CORS_ORIGINS', value: corsOrigins }
        { name: 'AZURE_STORAGE_ACCOUNT', value: 'cafirmosmehta226' }
        { name: 'AZURE_STORAGE_CONTAINER', value: 'client-documents' }
        { name: 'AZURE_AI_ENDPOINT', value: 'https://ca-firm-ai-20260912.openai.azure.com' }
        { name: 'AZURE_AI_DEPLOYMENT', value: 'gpt-4o-mini' }
        { name: 'SCM_DO_BUILD_DURING_DEPLOYMENT', value: 'true' }
        { name: 'ENABLE_ORYX_BUILD', value: 'true' }
        { name: 'ORYX_DISABLE_COMPRESSION', value: 'true' }
        { name: 'DATABASE_URL', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=database-url)' }
        { name: 'AZURE_STORAGE_ACCOUNT_KEY', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=azure-storage-account-key)' }
        { name: 'JWT_SECRET', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=jwt-secret)' }
        { name: 'AZURE_AI_API_KEY', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=azure-ai-api-key)' }
        { name: 'N8N_SERVICE_TOKEN', value: '@Microsoft.KeyVault(VaultName=${keyVaultName};SecretName=n8n-service-token)' }
      ]
    }
  }
}

resource scmAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: appService
  name: 'scm'
  properties: { allow: true }
}

resource ftpAuth 'Microsoft.Web/sites/basicPublishingCredentialsPolicies@2024-11-01' = {
  parent: appService
  name: 'ftp'
  properties: { allow: false }
}

output name string = appService.name
output principalId string = appService.identity.principalId
output defaultHostName string = appService.properties.defaultHostName