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

## How to set up this GitHub App

This process looks a bit complex, the main reason for that being that three things have to be set up essentially simultaneously: an Azure Function, a GitHub repository and a GitHub App.

### The Azure Function

First of all, a new [Azure Function](https://portal.azure.com/#blade/HubsExtension/BrowseResourceBlade/resourceType/Microsoft.Web%2Fsites/kind/functionapp) needs to be created. A Linux one is preferred, with a regular Consumption plan, for [cost](https://azure.microsoft.com/en-us/pricing/details/functions/) and performance reasons. Deployment with GitHub should _not_ yet be configured.

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

A few environment variables need to be configured for use with the Azure Function. This can be done on the "Configuration" tab, which is in the "Settings" group.

Concretely, the environment variables `GITHUB_WEBHOOK_SECRET` needs to be set, any generated random string can be used as its value (and the same value needs to be used when eventually registering the actual GitHub App).

Also, the `GITHUB_APP_ID` and `GITHUB_APP_PRIVATE_KEY` variables are needed in order to trigger GitHub workflow runs. These are obtained as part of registering the GitHub App (see below).

### The repository

Create a fork of https://github.com/gitgitgadget/gitgitgadget-github-app. Configure the Azure Managed Identity via Actions secrets, under the keys `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, and `AZURE_SUBSCRIPTION_ID`. Also, the `AZURE_FUNCTION_NAME` secret needs to be defined (its value is the name of the Azure Function).

Also configure the repository _variable_ `DEPLOY_WITH_WORKFLOWS`; Its value must correspond to the fork of https://github.com/gitgitgadget/gitgitgadget-workflows, in the form `<org>/gitgitgadget-workflows`. Note that that fork _must_ have a `config` branch that contains a valid project configuration in its `gitgitgadget-config.json` file.

As a last step, on the Actions tab, the `Deploy to Azure` workflow needs to be triggered manually, which deploys the Azure Function.

### The GitHub App

Now it is finally time to [register a new GitHub App](https://github.com/settings/apps/new) with https://github.com/<org>> as homepage URL.

As Webhook URL, use the URL of the Azure Function, which should look like this: https://<azure-function-name>.azurewebsites.net/api/GitGitGadget

The value stored in the Azure Function as `GITHUB_WEBHOOK_SECRET` was used as Webhook secret.

The GitGitGadget GitHub app requires the following permissions: Read access to metadata, Read and write access to Variables, Actions, Checks, Commit statuses, Contents, Issues, Pull requests, and Workflows. It needs the following webhook events to be enabled: Check run, Commit comment, Issue comment, Pull request, Pull request review, Pull request review comment, Push, Repository, and Status.

Once the GitHub App is successfully registered (and unfortunately only then), the private key can be generated via clicking the `Generate a private key` button in the "Private keys" section toward the bottom. This will automatically download a file; The contents of that file, with newlines replaced by `\n`, need to be configured as `GITHUB_APP_PRIVATE_KEY` environment variable in your Azure Function's `Settings>Environment variables` tab, and `GITHUB_APP_ID` needs to be set, too (it can be seen on the GitHub App's page at the top, labeled as "App ID").

The app needs to be installed on the fork of the `gitgitgadget-workflows` repository, and the app ID and private key should also be stored as Actions secrets in the fork of the `gitgitgadget-github-app` repository and it should be re-deployed so that it can pick up those new bits and pieces.

#### Using `register-github-app-cli`

A convenient alternative to clicky-clicky in the GitHub UI to register the GitHub is the convenient [`npx register-github-app-cli` command](https://github.com/gr2m/register-github-app-cli): Use it with `--org <owning-organization>` and a variation of this manifest:

```yml
name: <name>
url: https://github.com/apps/<name>
hook_attributes:
  url: https://<function-app-name>.azurewebsites.net/api/GitGitGadget
public: false
default_permissions:
  actions: write
  checks: write
  commit_statuses: write
  contents: write
  issues: write
  metadata: read
  pull_requests: write
  variables: read
  workflows: write
default_events:
  - check_run
  - commit_comment
  - issue_comment
  - pull_request
  - pull_request_review
  - pull_request_review_comment
  - push
  - repository
  - status
```

### A read-only GitHub App

In complex setups, like the one for the Git project, there is more than one repository in which users open Pull Requests that then get forwarded by GitGitGadget: In addition to the "pr-repo", there can be an "upstream-repo" that is owned by the upstream project and should not allow GitGitGadget to write to it.

To this end, a second GitHub App can be registered, one that lacks all permissions except Read/write on `issues` & `pull_requests` (to write PR comments) and `checks` (to mirror the workflow runs to the PRs). This will need to be configured on the `gitgitgadget-workflows` fork as `GITGITGADGET_READONLY_GITHUB_APP_ID` and `GITGITGADGET_READONLY_GITHUB_APP_PRIVATE_KEY` secrets.
