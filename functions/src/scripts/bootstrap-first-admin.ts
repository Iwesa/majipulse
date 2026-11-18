/**
 * Operator-run bootstrap for the first organization and administrator.
 *
 *   npm --prefix functions run build
 *   npm --prefix functions run bootstrap-first-admin -- \
 *     --project <id> --confirm-project <id> --org-id <org> --org-name "<name>" \
 *     --county <county> --email <admin email> [--admin-name "<name>"] [--demo] [--emulator]
 *   ... add --resume to finish an interrupted run
 *   ... or --cleanup --confirm-org <org> [--delete-created-user] to remove one
 */
import { parseArgs } from 'node:util'
import { BootstrapRefusal, bootstrapOptionsSchema, runBootstrap } from '../bootstrap.js'
import { createAdminPorts } from '../adminPorts.js'
import { consoleOutput, initAdminApp } from './cli.js'

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      project: { type: 'string' },
      'confirm-project': { type: 'string' },
      'org-id': { type: 'string' },
      'org-name': { type: 'string' },
      county: { type: 'string' },
      email: { type: 'string' },
      'admin-name': { type: 'string', default: 'Administrator' },
      demo: { type: 'boolean', default: false },
      emulator: { type: 'boolean', default: false },
      resume: { type: 'boolean', default: false },
      cleanup: { type: 'boolean', default: false },
      'confirm-org': { type: 'string' },
      'delete-created-user': { type: 'boolean', default: false },
    },
    strict: true,
  })

  if (values.resume && values.cleanup) {
    console.error('Use either --resume or --cleanup, not both.')
    return 2
  }

  const parsed = bootstrapOptionsSchema.safeParse({
    mode: values.cleanup ? 'cleanup' : values.resume ? 'resume' : 'run',
    project: values.project,
    confirmProject: values['confirm-project'],
    orgId: values['org-id'],
    orgName: values['org-name'],
    county: values.county,
    email: values.email,
    adminName: values['admin-name'],
    demo: values.demo,
    confirmOrg: values['confirm-org'],
    deleteCreatedUser: values['delete-created-user'],
  })
  if (!parsed.success) {
    // Report which options are invalid, never their values.
    const fields = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
    console.error(`Missing or invalid options: ${fields.join(', ')}. Nothing was changed.`)
    return 2
  }

  const app = initAdminApp(parsed.data.project, values.emulator)
  try {
    const result = await runBootstrap(createAdminPorts(app), parsed.data, consoleOutput)
    console.log(result.outcome === 'complete' ? 'Bootstrap complete.' : 'Cleanup complete.')
    return 0
  } catch (error) {
    if (error instanceof BootstrapRefusal) {
      console.error(`Stopped: ${error.message}`)
      return 1
    }
    console.error('Stopped by an unexpected error. Run again with --resume after checking the cause.')
    console.error(error instanceof Error ? error.message : String(error))
    return 1
  }
}

process.exitCode = await main()
