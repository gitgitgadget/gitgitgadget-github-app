/*
 * This is the Azure Function backing the GitGitGadget GitHub App.
 *
 * As Azure Functions do not support Typescript natively yet, we implement it in
 * pure Javascript and keep it as simple as possible.
 *
 * Note: while the Azure Function Runtime v1 supported GitHub webhooks natively,
 * via the "webHookType", starting with v2, we have to do the payload
 * validation "by hand".
 */
const { validateGitHubWebHook } = require('./validate-github-webhook');

const { triggerAzurePipeline } = require('./trigger-azure-pipeline');

const { triggerWorkflowDispatch } = require('./trigger-workflow-dispatch');

const { isUserAuthorized } = require('./is-user-authorized');

module.exports = async (context, req) => {
    try {
        validateGitHubWebHook(context);
    } catch (e) {
        context.log('Caught ' + e);
        context.res = {
            status: 403,
            body: 'Not a valid GitHub webhook: ' + e,
        };
        context.done();
        return;
    }

    try {
        /*
         * The Azure Pipeline needs to be installed as a PR build on _the very
         * same_ repository that triggers this function. That is, when the
         * Azure Function triggers GitGitGadget for gitgitgadget/git, it needs
         * to know that pipelineId 3 is installed on gitgitgadget/git, and
         * trigger that very pipeline.
         *
         * So whenever we extend GitGitGadget to handle another repository, we
         * will have to add an Azure Pipeline, install it on that repository as
         * a PR build, and add the information here.
         */
        const pipelines = {
            'dscho': 12,
            'git': 13,
            'gitgitgadget': 3,
        };

        const eventType = context.req.headers['x-github-event'];
        context.log(`Got eventType: ${eventType}`);
        const repositoryOwner = req.body.repository.owner.login;
        if (pipelines[repositoryOwner] === undefined) {
            context.res = {
                status: 403,
                body: 'Refusing to work on a repository other than gitgitgadget/git or git/git'
            };
        } else if ((new Set(['check_run', 'status']).has(eventType))) {
            context.res = {
                body: `Ignored event type: ${eventType}`,
            };
        } else if (eventType === 'push') {
            if (req.body.repository.full_name !== 'git/git') {
                context.res = { body: `Ignoring pushes to ${req.body.repository.full_name}` }
            } else {
                const run = await triggerWorkflowDispatch(
                    context,
                    undefined,
                    'gitgitgadget',
                    'gitgitgadget-workflows',
                    'sync-ref.yml',
                    'main', {
                        ref: req.body.ref
                    }
                )
                context.res = { body: `push(${req.body.ref}): triggered ${run.html_url}` }
            }
        } else if (eventType === 'issue_comment') {
            const triggerToken = process.env['GITGITGADGET_TRIGGER_TOKEN'];
            if (!triggerToken) {
                throw new Error('No configured trigger token');
            }

            const comment = req.body.comment;
            const prNumber = req.body.issue.number;
            if (!comment || !comment.id || !prNumber) {
                context.log(`Invalid payload:\n${JSON.stringify(req.body, null, 4)}`);
                throw new Error('Invalid payload');
            }

            /* GitGitGadget works on dscho/git only for testing */
            if (repositoryOwner === 'dscho' && comment.user.login !== 'dscho') {
                throw new Error(`Ignoring comment from ${comment.user.login}`);
            }

            /* Only trigger the Pipeline for commands */
            if (!comment.body || !comment.body.startsWith('/')) {
                context.res = {
                    body: `Not a command: '${comment.body}'`,
                };
                context.done();
                return;
            }

            if (!(req.body.sender.site_admin || await isUserAuthorized(context, comment.sender.login))) {
                context.res = {
                    status: 403,
                    body: `Commenter @{comment.sender.login} not authorized: ${comment.html_url}`,
                };
                context.done();
                return;
            }

            /* Only trigger the Pipeline for valid commands */
            if (!comment.body || !comment.body.match(/^\/(submit|preview|allow|disallow|test|cc)\b/)) {
                context.res = {
                    body: `Not a command: '${comment.body}'`,
                };
                context.done();
                return;
            }

            const sourceBranch = `refs/pull/${prNumber}/head`;
            const parameters = {
                'pr.comment.id': comment.id,
            };
            const pipelineId = pipelines[repositoryOwner];
            if (!pipelineId || pipelineId < 1)
                throw new Error(`No pipeline set up for org ${repositoryOwner}`);
            context.log(`Queuing with branch ${sourceBranch} and parameters ${JSON.stringify(parameters)}`);
            await triggerAzurePipeline(triggerToken, 'gitgitgadget', 'git', pipelineId, sourceBranch, parameters);

            context.res = {
                // status: 200, /* Defaults to 200 */
                body: 'Okay!',
            };
        } else {
            context.log(`Unhandled request:\n${JSON.stringify(req, null, 4)}`);
            context.res = {
                body: 'No idea what this is about, but okay.',
            };
        }
    } catch (e) {
        context.log('Caught exception ' + e);
        context.res = {
            status: 500,
            body: 'Caught an error: ' + e,
        };
    }

    context.done();
};
