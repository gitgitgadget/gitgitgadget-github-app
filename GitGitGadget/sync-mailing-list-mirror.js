const { isUpToDate } = require('./mailing-list-mirror')

module.exports = async context => {
    try {
        const { readFileSync } = require('fs')
        const config = JSON.parse(readFileSync(`${__dirname}/gitgitgadget-config.json`))
        if (await isUpToDate(config)) {
            context.log('Mailing-list mirror is up to date')
            return
        }

        const { owner, name } = config.workflowsRepo
        const workflow = 'sync-mailing-list-mirror.yml'
        const { getInstallationIdForRepo } = require('./get-installation-id-for-repo')
        const { getInstallationAccessToken } = require('./get-installation-access-token')
        const installationID = await getInstallationIdForRepo(context, owner, name)
        const token = await getInstallationAccessToken(context, installationID)
        const { listWorkflowRuns, triggerWorkflowDispatch } = require('./trigger-workflow-dispatch')

        for (const status of ['queued', 'in_progress']) {
            const runs = await listWorkflowRuns(context, token, owner, name, workflow, 'main', status)
            if (runs.length) {
                context.log(`Skipping mirror sync; a run is already ${status}`)
                return
            }
        }

        const run = await triggerWorkflowDispatch(context, token, owner, name, workflow, 'main')
        context.log(`Triggered mailing-list mirror sync: ${run.html_url}`)
    } catch (e) {
        context.log('Caught exception ', e)
        throw e
    }
}
