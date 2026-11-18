/**
 * First-organization and first-administrator bootstrap (design "Provisioning").
 * Operator-run only. Never deployed or callable from the app.
 *
 * Every step checks current state before writing, so a run that fails partway
 * can be resumed (--resume) or removed (--cleanup) without creating a second
 * administrator or touching accounts the bootstrap does not own.
 */
import { z } from 'zod'
import {
  claimsEqual,
  displayNameSchema,
  emailSchema,
  hasNoClaims,
  orgClaims,
  organizationIdSchema,
  type Role,
} from './domain.js'
import type { AuthUser, OrganizationRecord, Ports } from './ports.js'
import { AlreadyExistsError } from './ports.js'

export type BootstrapMode = 'run' | 'resume' | 'cleanup'

export const bootstrapOptionsSchema = z.object({
  mode: z.enum(['run', 'resume', 'cleanup']),
  project: z.string().min(1),
  confirmProject: z.string().min(1),
  orgId: organizationIdSchema,
  orgName: z.string().trim().min(1).max(120),
  county: z.string().trim().min(1).max(80),
  email: emailSchema,
  adminName: displayNameSchema,
  demo: z.boolean(),
  /** Cleanup only: must equal orgId. */
  confirmOrg: z.string().optional(),
  /** Cleanup only: also delete the Auth user, if the bootstrap created it. */
  deleteCreatedUser: z.boolean(),
})
export type BootstrapOptions = z.infer<typeof bootstrapOptionsSchema>

export interface BootstrapOutput {
  info(message: string): void
  /** Prints a sensitive value once, to the terminal only. */
  secret(label: string, value: string): void
}

/** The script stopped deliberately. Nothing after the reported point was changed. */
export class BootstrapRefusal extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BootstrapRefusal'
  }
}

export type BootstrapResult =
  | { outcome: 'complete'; adminUid: string }
  | { outcome: 'cleaned-up' }

const ADMIN: Role = 'administrator'

const keysOf = (claims: Readonly<Record<string, unknown>>) => Object.keys(claims).sort().join(', ')

export async function runBootstrap(ports: Ports, options: BootstrapOptions, out: BootstrapOutput): Promise<BootstrapResult> {
  if (options.project !== options.confirmProject) {
    throw new BootstrapRefusal('--project and --confirm-project do not match. Nothing was changed.')
  }
  switch (options.mode) {
    case 'run':
      return freshRun(ports, options, out)
    case 'resume':
      return resume(ports, options, out)
    case 'cleanup':
      return cleanup(ports, options, out)
  }
}

/**
 * Refuses any existing account that already belongs somewhere: a member
 * document in any organization, or any custom claims at all, because
 * setClaims replaces the whole map (R11.9).
 */
async function guardExistingUser(ports: Ports, user: AuthUser, orgId: string): Promise<void> {
  if (await ports.store.getMember(user.uid)) {
    throw new BootstrapRefusal(
      'This email belongs to an account that is already a member of an organization. Use a different email. Nothing was changed.',
    )
  }
  if (!hasNoClaims(user.customClaims)) {
    if (claimsEqual(user.customClaims, orgClaims(orgId, ADMIN))) {
      throw new BootstrapRefusal(
        `This account already has administrator claims for "${orgId}", but the organization is not set up. ` +
          'Remove the custom claims from this account (Admin SDK setCustomUserClaims(uid, null)) and run again. Nothing was changed.',
      )
    }
    throw new BootstrapRefusal(
      `This account already has custom claims (keys: ${keysOf(user.customClaims)}). Use a different email. Nothing was changed.`,
    )
  }
}

async function freshRun(ports: Ports, options: BootstrapOptions, out: BootstrapOutput): Promise<BootstrapResult> {
  const { orgId } = options

  // Step 1: preflight. Read only.
  const existingOrg = await ports.store.getOrganization(orgId)
  if (existingOrg?.bootstrap.status === 'complete') {
    throw new BootstrapRefusal(`Organization "${orgId}" is already bootstrapped. Nothing was changed.`)
  }
  if (existingOrg) {
    throw new BootstrapRefusal(
      `A bootstrap for "${orgId}" was started but not finished. Run again with --resume, or with --cleanup to remove it.`,
    )
  }
  const existingUser = await ports.auth.findUserByEmail(options.email)
  if (existingUser) await guardExistingUser(ports, existingUser, orgId)

  // Step 2: organization in progress.
  try {
    await ports.store.createOrganization(orgId, {
      name: options.orgName,
      county: options.county,
      demo: options.demo,
      bootstrap: { status: 'in_progress' },
    })
  } catch (error) {
    if (error instanceof AlreadyExistsError) {
      throw new BootstrapRefusal(`Organization "${orgId}" was created by another process. Nothing was changed.`)
    }
    throw error
  }
  out.info(`Step 2: organization "${orgId}" created (setup in progress).`)

  return completeSteps(ports, options, out, existingUser, false)
}

async function resume(ports: Ports, options: BootstrapOptions, out: BootstrapOutput): Promise<BootstrapResult> {
  const { orgId } = options
  const org = await ports.store.getOrganization(orgId)
  if (!org) throw new BootstrapRefusal(`Organization "${orgId}" does not exist. There is nothing to resume.`)
  if (org.bootstrap.status === 'complete') {
    throw new BootstrapRefusal(`Organization "${orgId}" is already bootstrapped. Nothing was changed.`)
  }

  const user = await ports.auth.findUserByEmail(options.email)
  const recordedUid = org.bootstrap.adminUid

  if (recordedUid) {
    if (!user) {
      throw new BootstrapRefusal(
        'The administrator recorded for this bootstrap has no account with this email. Check --email, or use --cleanup.',
      )
    }
    if (user.uid !== recordedUid) {
      throw new BootstrapRefusal(
        'This email belongs to a different account than the administrator recorded for this bootstrap. Nothing was changed.',
      )
    }
    if (!hasNoClaims(user.customClaims) && !claimsEqual(user.customClaims, orgClaims(orgId, ADMIN))) {
      throw new BootstrapRefusal(
        `The recorded administrator's claims were changed outside this script (keys: ${keysOf(user.customClaims)}). ` +
          'Review the account manually. Nothing was changed.',
      )
    }
    const member = await ports.store.getMember(user.uid)
    if (member && (member.organizationId !== orgId || member.role !== ADMIN)) {
      throw new BootstrapRefusal(
        "The recorded administrator's member record belongs to another organization or role. Nothing was changed.",
      )
    }
  } else if (user) {
    // Failed before the administrator was recorded: treat the account like a new bootstrap would.
    await guardExistingUser(ports, user, orgId)
  }

  out.info(`Resuming bootstrap for "${orgId}".`)
  return completeSteps(ports, options, out, user, org.bootstrap.userCreatedByBootstrap ?? false)
}

/** Steps 3 to 7. Each step checks current state first, so repeating it is safe. */
async function completeSteps(
  ports: Ports,
  options: BootstrapOptions,
  out: BootstrapOutput,
  existingUser: AuthUser | null,
  previouslyCreated: boolean,
): Promise<BootstrapResult> {
  const { orgId } = options
  const expected = orgClaims(orgId, ADMIN)

  // Step 3: administrator account.
  const user = existingUser ?? (await ports.auth.createUser({ email: options.email, displayName: options.adminName }))
  const createdNow = existingUser === null
  await ports.store.updateBootstrap(orgId, {
    adminUid: user.uid,
    userCreatedByBootstrap: createdNow || previouslyCreated,
  })
  out.info(createdNow ? 'Step 3: administrator account created.' : 'Step 3: using the existing administrator account.')

  // Step 4: claims. Re-read right before writing, in case they changed since preflight.
  const current = await ports.auth.getUser(user.uid)
  if (!current) throw new BootstrapRefusal('The administrator account disappeared. Run again with --resume.')
  if (claimsEqual(current.customClaims, expected)) {
    out.info('Step 4: administrator claims already set.')
  } else if (!hasNoClaims(current.customClaims)) {
    throw new BootstrapRefusal(
      `The account gained custom claims during setup (keys: ${keysOf(current.customClaims)}). They were not changed. ` +
        'Review the account, then run again with --resume or --cleanup.',
    )
  } else {
    await ports.auth.setClaims(user.uid, expected)
    out.info('Step 4: administrator claims set.')
  }

  // Step 5: member document.
  const member = await ports.store.getMember(user.uid)
  if (member) {
    if (member.organizationId !== orgId || member.role !== ADMIN) {
      throw new BootstrapRefusal('A different member record exists for this account. Nothing more was changed.')
    }
    out.info('Step 5: member record already exists.')
  } else {
    try {
      await ports.store.createMember(user.uid, {
        organizationId: orgId,
        role: ADMIN,
        email: options.email,
        displayName: options.adminName,
        active: true,
      })
    } catch (error) {
      if (error instanceof AlreadyExistsError) {
        throw new BootstrapRefusal('A member record was created by another process. Run again with --resume.')
      }
      throw error
    }
    out.info('Step 5: member record created.')
  }

  // Step 6: password reset link, printed once to the terminal only. This runs
  // before marking complete so a failure here can still be resumed.
  const link = await ports.auth.passwordResetLink(options.email)
  out.secret('Password reset link for the administrator (share it privately; it is shown only once)', link)

  // Step 7: complete.
  await ports.store.updateBootstrap(orgId, { status: 'complete' })
  out.info(`Step 7: organization "${orgId}" is ready.`)
  return { outcome: 'complete', adminUid: user.uid }
}

async function cleanup(ports: Ports, options: BootstrapOptions, out: BootstrapOutput): Promise<BootstrapResult> {
  const { orgId } = options
  if (options.confirmOrg !== orgId) {
    throw new BootstrapRefusal(`Cleanup needs --confirm-org ${orgId}. Nothing was changed.`)
  }
  const org: OrganizationRecord | null = await ports.store.getOrganization(orgId)
  if (!org) throw new BootstrapRefusal(`Organization "${orgId}" does not exist. Nothing was changed.`)
  if (org.bootstrap.status !== 'in_progress') {
    throw new BootstrapRefusal('Only an unfinished bootstrap can be cleaned up. Nothing was changed.')
  }

  const adminUid = org.bootstrap.adminUid
  const otherMembers = (await ports.store.listMemberUids(orgId)).filter((uid) => uid !== adminUid)
  if (otherMembers.length > 0) {
    throw new BootstrapRefusal('The organization has other members, so it cannot be cleaned up. Nothing was changed.')
  }

  if (adminUid) {
    const user = await ports.auth.getUser(adminUid)
    if (user && claimsEqual(user.customClaims, orgClaims(orgId, ADMIN))) {
      await ports.auth.setClaims(adminUid, null)
      out.info('Removed the administrator claims set by this bootstrap.')
    } else if (user && !hasNoClaims(user.customClaims)) {
      out.info(`Left the account's claims unchanged (keys: ${keysOf(user.customClaims)}); they were not set by this bootstrap.`)
    }

    const member = await ports.store.getMember(adminUid)
    if (member && member.organizationId === orgId) {
      await ports.store.deleteMember(adminUid)
      out.info('Removed the member record.')
    }

    if (user && options.deleteCreatedUser) {
      if (org.bootstrap.userCreatedByBootstrap === true) {
        await ports.auth.deleteUser(adminUid)
        out.info('Deleted the account created by this bootstrap.')
      } else {
        out.info('Kept the account: it existed before this bootstrap.')
      }
    }
  }

  await ports.store.deleteOrganization(orgId)
  out.info(`Removed organization "${orgId}".`)
  return { outcome: 'cleaned-up' }
}
