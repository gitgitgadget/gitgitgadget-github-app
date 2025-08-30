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

const { triggerWorkflowDispatch, listWorkflowRuns } = require('./trigger-workflow-dispatch')

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
        const { readFileSync } = require('fs')
        const config = JSON.parse(readFileSync(`${__dirname}/gitgitgadget-config.json`))
        const orgs = config.repo.owners
        const a = [context, undefined, config.workflowsRepo.owner, config.workflowsRepo.name]

        const eventType = context.req.headers['x-github-event'];
        context.log(`Got eventType: ${eventType}`);
        const repositoryOwner = req.body.repository.owner.login;
        if (!orgs.includes(repositoryOwner)) {
            context.res = {
                status: 403,
                body: `Refusing to work on any repository outside of ${orgs.join(', ')}`,
            };
        } else if (eventType === 'pull_request') {
            if (req.body.action !== 'opened' && req.body.action !== 'synchronize') {
                context.res = {
                    body: `Ignoring pull request action: ${req.body.action}`,
                };
            } else {
                const run = await triggerWorkflowDispatch(...a, 'handle-pr-push.yml', 'main', {
                    'pr-url': req.body.pull_request.html_url
                })
                context.res = { body: `Okay, triggered ${run.html_url}!` };
            }
        } else if ((new Set(['check_run', 'status']).has(eventType))) {
            context.res = {
                body: `Ignored event type: ${eventType}`,
            };
        } else if (eventType === 'push') {
            if (config.mailrepo.mirrorURL === `https://github.com/${req.body.repository.full_name}`) {
                context.res = { body: `push(${req.body.ref} in ${req.body.repository.full_name}): ` }
                if (req.body.ref === config.mailrepo.mirrorRef) {
                    const queued = await listWorkflowRuns(...a, 'handle-new-mails.yml', 'queued')
                    if (queued.length) {
                        context.res.body += [
                            `skip triggering handle-new-emails, ${queued} already queued:`,
                            queued.map(e => `- ${e.html_url}`)
                        ].join('\n')
                    } else {
                        const run = await triggerWorkflowDispatch(...a, 'handle-new-mails.yml', 'main')
                        context.res.body += `triggered ${run.html_url}`
                    }
                } else context.res.body += `Ignoring non-default branches`
            } else if (req.body.repository.full_name !== `${config.repo.baseOwner}/${config.repo.name}`) {
                context.res = { body: `Ignoring pushes to ${req.body.repository.full_name}` }
            } else {
                const run = await triggerWorkflowDispatch(
                    ...a,
                    'sync-ref.yml',
                    'main', {
                        ref: req.body.ref
                    }
                )
                const extra = []
                if (config.repo.branches.map((name) => `refs/heads/${name}`).includes(req.body.ref)) {
                    for (const workflow of ['update-prs.yml', 'update-mail-to-commit-notes.yml']) {
                        if ((await listWorkflowRuns(...a, workflow, 'main', 'queued')).length === 0) {
                            const run = await triggerWorkflowDispatch(...a, workflow, 'main')
                            extra.push(` and ${run.html_url}`)
                        }
                    }
                }
                context.res = { body: `push(${req.body.ref}): triggered ${run.html_url}${extra.join('')}` }
            }
        } else if (eventType === 'issue_comment') {
            const comment = req.body.comment;
            const prNumber = req.body.issue.number;
            if (!comment || !comment.id || !prNumber) {
                context.log(`Invalid payload:\n${JSON.stringify(req.body, null, 4)}`);
                throw new Error('Invalid payload');
            }

            /* GitGitGadget works on dscho/git only for testing */
            if (repositoryOwner === config.repo.testOwner && comment.user.login !== config.repo.testOwner) {
                throw new Error(`Ignoring comment from ${comment.user.login}`);
            }

            /* Only trigger the Pipeline for valid commands */
            if (!comment.body || !comment.body.match(/^\/(submit|preview|allow|disallow|test|cc)\b/)) {
                context.res = {
                    body: `Not a command: '${comment.body}'`,
                };
                context.done();
                return;
            }

            const run = await triggerWorkflowDispatch(...a, 'handle-pr-comment.yml', 'main', {
                'pr-comment-url': comment.html_url
            })

            context.res = {
                // status: 200, /* Defaults to 200 */
                body: `Okay, triggered ${run.html_url}!`,
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
