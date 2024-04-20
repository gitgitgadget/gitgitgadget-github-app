# GitGitGadget's GitHub App

The purpose of GitGitGadget's GitHub App is two-fold:

- It acts upon GitHub webhook events, sent by GitHub
- It allows GitGitGadget to act as the App, adding PR comments and pushing tags in the respective GitHub workflows

## Tips & Tricks for developing this GitHub App

### Debug/test-run as much Javascript via the command-line as possible

The easiest, and quickest, way to test most of the Javascript code is to run it on the command-line, via `node`.

To facilitate that, future functionality will be implemented in individually-testable modules as possible.

### Run the Azure Function locally

It is tempting to try to develop the Azure Function part of this GitHub App directly in the Azure Portal, but it is cumbersome and slow, and also impossibly unwieldy once the Azure Function has been deployed via GitHub (because that disables editing the Javascript code in the Portal).

Instead of pushing the code to Azure all the time, waiting until it is deployed, reading the logs, then editing the code, committing and starting another cycle, it is much, much less painful to develop the Azure Function locally.

To this end, [install the Azure Functions Core Tools (for performance, use Linux)](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local?tabs=v4%2Clinux%2Ccsharp%2Cportal%2Cbash#install-the-azure-functions-core-tools, e.g. via [WSL](https://learn.microsoft.com/en-us/windows/wsl/)).

Then, configure [the `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` and `GITHUB_WEBHOOK_SECRET` variables](#some-environment-variables) locally, via [a `local.settings.json` file](https://learn.microsoft.com/en-us/azure/azure-functions/functions-develop-local#local-settings-file). The contents would look like this:

```json
{
  "IsEncrypted": false,
  "Values": {
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AzureWebJobsStorage": "<storage-key>",
    "GITHUB_APP_ID": "<app-id>",
    "GITHUB_APP_PRIVATE_KEY": "<private-key>",
    "GITHUB_WEBHOOK_SECRET": "<webhook-secret>"
  },
  "Host": {
    "LocalHttpPort": 7071,
    "CORS": "*",
    "CORSCredentials": false
  }
}
```

Finally, [run the Function locally](https://learn.microsoft.com/en-us/azure/azure-functions/functions-run-local?tabs=v4%2Clinux%2Cnode%2Cportal%2Cbash#start) by calling `func start` on the command-line.

You can also run/debug it via VS Code, there is a default configuration called "Attach to Node Functions".

## How this GitHub App was set up

This process looks a bit complex, the main reason for that being that three things have to be set up essentially simultaneously: an Azure Function, a GitHub repository and a GitHub App.

### The Azure Function

First of all, a new [Azure Function](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.Web%2Fsites/kind/functionapp) was created. A Linux one was preferred, for cost and performance reasons. Deployment with GitHub was _not_ yet configured.

#### Obtaining the Azure credentials

The idea is to use [OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) to log into Azure in the deploy workflow, _identifying_ as said workflow, via a "Managed Identity". This can be registered after the Azure Function has been successfully created: In an Azure CLI (for example [the one that is very neatly embedded in the Azure Portal](https://learn.microsoft.com/en-us/azure/cloud-shell/get-started/classic)), run this (after replacing the placeholders `{subscription-id}`, `{resource-group}` and `{app-name}`):

```shell
az identity create --name <managed-identity-name> -g <resource-group>
az identity federated-credential create \
  --identity-name <managed-identity-name> \
  --resource-group <resource-group> \
  --name github-workflow \
  --issuer https://token.actions.githubusercontent.com \
  --subject repo:<org>/gitgitgadget-github-app:environment:deploy-to-azure \
  --audiences api://AzureADTokenExchange
# The scope can be copied from the Azure Portal URL after navigating to the Azure Function
az role assignment create \
  --assignee <client-id-of-managed-identity> \
  --scope '/subscriptions/<subscription-id>/resourceGroups/<resource-group>/providers/Microsoft.Web/sites/<azure-function-name>' \
  --role 'Contributor'
```

The result is a "managed identity", essentially a tightly-scoped credential that allows deploying this particular Azure Function from that particular repository in a GitHub workflow run and that's it. This managed identity is identified via the `AZURE_CLIENT_ID`, `AZURE_TENANT_ID` and `AZURE_SUBSCRIPTION_ID` Actions secrets, more on that below.

#### Some environment variables

A few environment variables will have to be configured for use with the Azure Function. This can be done on the "Configuration" tab, which is in the "Settings" group.

Concretely, the environment variables `GITHUB_WEBHOOK_SECRET` and `GITGITGADGET_TRIGGER_TOKEN` (a Personal Access Token to trigger the Azure Pipelines) need to be set. For the first, a generated random string was used. The second one was [created](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate?view=azure-devops&tabs=Windows#create-a-pat) scoped to the Azure DevOps project `gitgitgadget` with the Build (read & execute) permissions.

Also, the `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` variables are needed in order to trigger GitHub workflow runs. These were obtained as part of registering the GitHub App.

### The repository

Create a fork of https://github.com/gitgitgadget/gitgitgadget-github-app. Configure the Azure Managed Identity via Actions secrets, under the keys `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`. Also, the `AZURE_FUNCTION_NAME` secret needs to be defined (its value is the name of the Azure Function).

This repository was initialized locally by forking https://github.com/gitgitgadget/gitgitgadget and separating out the Azure Functions part of it. Then, the test suite was developed and the GitHub workflows were adapted from https://github.com/git-for-windows/gfw-helper-github-app. After that, the `origin` remote was set to the newly registered repository on GitHub.

As a last step, the repository was pushed, triggering the deployment to the Azure Function.

### The GitHub App

Finally, the existing GitHub App's webhook URL was redirected to the new one. If there had not been an existing GitHub App, [a new GitHub App would have been registered](https://github.com/settings/apps/new) with https://github.com/gitgitgadget as homepage URL.

As Webhook URL, the URL of the Azure Function was used, which can be copied in the "Functions" tab of the Azure Function. It looks similar to this: https://my-github-app.azurewebsites.net/api/MyGitHubApp

The value stored in the Azure Function as `GITHUB_WEBHOOK_SECRET` was used as Webhook secret.

The GitGitGadget GitHub app requires the following permissions: Read access to metadata, and Read and write access to checks, code, commit statuses, issues, pull requests, and workflows.