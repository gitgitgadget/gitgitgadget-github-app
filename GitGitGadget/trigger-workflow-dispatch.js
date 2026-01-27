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

    const { headers: { date } } = await gitHubAPIRequest(
        context,
        token,
        'POST',
        `/repos/${owner}/${repo}/actions/workflows/${workflow_id}/dispatches`,
        { ref, inputs }
    )

    const runs = await waitForWorkflowRun(context, token, owner, repo, workflow_id, new Date(date).toISOString())
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
