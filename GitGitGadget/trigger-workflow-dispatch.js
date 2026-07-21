const { gitHubAPIRequest } = require('./github-api-request')
const { gitHubAPIRequestAsApp } = require('./github-api-request-as-app')

const sleep = async (milliseconds) => {
    return new Promise((resolve) => {
        setTimeout(resolve, milliseconds)
    })
}

const getActorForToken = async (context, token) => {
    try {
        const { login } = await gitHubAPIRequest(context, token, 'GET', '/user')
        return login
    } catch (e) {
        if (e.statusCode !== 403 || e.json?.message !== 'Resource not accessible by integration') throw e
        const answer = await gitHubAPIRequestAsApp(context, 'GET', '/app')
        return `${answer.slug}[bot]`
    }
}

const waitForWorkflowRun = async (context, token, owner, repo, workflow_id, after, actor) => {
    if (!actor) actor = await getActorForToken(context, token)
    let counter = 0
    for (;;) {
        const res = await gitHubAPIRequest(
            context,
            token,
            'GET',
            `/repos/${owner}/${repo}/actions/runs?actor=${actor}&event=workflow_dispatch&created=${after}..*`
        )
        const filtered = res.workflow_runs.filter(e => e.path === `.github/workflows/${workflow_id}` && after.localeCompare(e.created_at) <= 0)
        if (filtered.length > 0) return filtered
        if (counter++ > 30) throw new Error(`Times out waiting for workflow?`)
        await sleep(1000)
    }
}

const triggerWorkflowDispatch = async (context, token, owner, repo, workflow_id, ref, inputs) => {
    if (token === undefined) {
        const { getInstallationIdForRepo } = require('./get-installation-id-for-repo')
        const installationID = await getInstallationIdForRepo(context, owner, repo)

        const { getInstallationAccessToken } = require('./get-installation-access-token')
        token = await getInstallationAccessToken(context, installationID)
    }

    const response = await gitHubAPIRequest(
        context,
        token,
        'POST',
        `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`,
        { ref, inputs, return_run_details: true }
    )

    if (response.workflow_run_id) return response

    const date = response.headers?.date || new Date().toISOString()
    // Avoid missing the run if its timestamp is slightly earlier than the response.
    const after = new Date(Date.parse(date) - 5000).toISOString()
    const runs = await waitForWorkflowRun(context, token, owner, repo, workflow_id, after)
    return runs[0]
}

const listWorkflowRuns = async (context, token, owner, repo, workflow_id, branch, status) => {
    if (token === undefined) {
        const { getInstallationIdForRepo } = require('./get-installation-id-for-repo')
        const installationID = await getInstallationIdForRepo(context, owner, repo)

        const { getInstallationAccessToken } = require('./get-installation-access-token')
        token = await getInstallationAccessToken(context, installationID)
    }

    const query = [
        branch && `branch=${branch}`,
        status && `status=${status}`,
    ]
        .filter((e) => e)
        .map((e, i) => `${i === 0 ? '?' : '&'}${e}`)
        .join('')

    const result = await gitHubAPIRequest(
        context,
        token,
        'GET',
        `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/runs${query}`,
    )
    return result.workflow_runs
}

module.exports = {
    triggerWorkflowDispatch,
    waitForWorkflowRun,
    listWorkflowRuns,
}
