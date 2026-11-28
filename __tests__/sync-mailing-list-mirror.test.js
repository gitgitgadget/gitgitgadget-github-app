const mockIsUpToDate = jest.fn()
const mockGetInstallationIdForRepo = jest.fn()
const mockGetInstallationAccessToken = jest.fn()
const mockListWorkflowRuns = jest.fn()
const mockTriggerWorkflowDispatch = jest.fn()

jest.mock('../GitGitGadget/mailing-list-mirror', () => ({ isUpToDate: mockIsUpToDate }))
jest.mock('../GitGitGadget/get-installation-id-for-repo', () => ({
    getInstallationIdForRepo: mockGetInstallationIdForRepo
}))
jest.mock('../GitGitGadget/get-installation-access-token', () => ({
    getInstallationAccessToken: mockGetInstallationAccessToken
}))
jest.mock('../GitGitGadget/trigger-workflow-dispatch', () => ({
    listWorkflowRuns: mockListWorkflowRuns,
    triggerWorkflowDispatch: mockTriggerWorkflowDispatch
}))

const syncMailingListMirror = require('../GitGitGadget/sync-mailing-list-mirror')

const makeContext = () => ({ log: jest.fn() })

beforeEach(() => {
    jest.clearAllMocks()
    mockIsUpToDate.mockResolvedValue(true)
    mockGetInstallationIdForRepo.mockResolvedValue(17)
    mockGetInstallationAccessToken.mockResolvedValue('installation-token')
    mockListWorkflowRuns.mockResolvedValue([])
    mockTriggerWorkflowDispatch.mockResolvedValue({ html_url: 'https://github.com/run/1' })
})

test('does not dispatch a sync when the mirror is current', async () => {
    const context = makeContext()

    await syncMailingListMirror(context)

    expect(mockGetInstallationIdForRepo).not.toHaveBeenCalled()
    expect(mockTriggerWorkflowDispatch).not.toHaveBeenCalled()
    expect(context.log).toHaveBeenCalledWith('Mailing-list mirror is up to date')
})

test('dispatches a sync when lore is ahead and no run is active', async () => {
    const context = makeContext()
    mockIsUpToDate.mockResolvedValue(false)

    await syncMailingListMirror(context)

    expect(mockListWorkflowRuns).toHaveBeenCalledTimes(2)
    expect(mockTriggerWorkflowDispatch).toHaveBeenCalledWith(
        context,
        'installation-token',
        'gitgitgadget-workflows',
        'gitgitgadget-workflows',
        'sync-mailing-list-mirror.yml',
        'main'
    )
})

test.each(['queued', 'in_progress'])('does not dispatch while a sync is %s', async status => {
    const context = makeContext()
    mockIsUpToDate.mockResolvedValue(false)
    mockListWorkflowRuns.mockImplementation(async (_context, _token, _owner, _repo, _workflow, _branch, queriedStatus) => {
        return queriedStatus === status ? [{ status }] : []
    })

    await syncMailingListMirror(context)

    expect(mockTriggerWorkflowDispatch).not.toHaveBeenCalled()
    expect(context.log).toHaveBeenCalledWith(`Skipping mirror sync; a run is already ${status}`)
})

test('propagates a failure to read the mailing-list refs', async () => {
    const context = makeContext()
    const error = new Error('lore is unavailable')
    mockIsUpToDate.mockRejectedValue(error)

    await expect(syncMailingListMirror(context)).rejects.toThrow('lore is unavailable')

    expect(mockGetInstallationIdForRepo).not.toHaveBeenCalled()
    expect(mockTriggerWorkflowDispatch).not.toHaveBeenCalled()
    expect(context.log).toHaveBeenCalledWith('Caught exception ', error)
})
