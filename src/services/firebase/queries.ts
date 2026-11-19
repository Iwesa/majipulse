import { collection, limit, orderBy, query, where, type Firestore, type Query, type QueryConstraint } from 'firebase/firestore'
import type { QueryPlan } from '../queryPlans'

/**
 * The only way services build collection queries. Firestore rules are not
 * filters: a query without the organizationId constraint is denied, so this
 * helper always adds it first (design 4, "Query security").
 */
export function orgScopedQuery(
  db: Firestore,
  collectionPath: string,
  organizationId: string,
  ...constraints: QueryConstraint[]
): Query {
  if (!organizationId) throw new Error('orgScopedQuery needs an organizationId')
  return query(collection(db, collectionPath), where('organizationId', '==', organizationId), ...constraints)
}

/** Builds the Firestore query for a plan (T7.1). The plan is what the index test checks. */
export function plannedQuery(db: Firestore, organizationId: string, plan: QueryPlan): Query {
  const constraints: QueryConstraint[] = plan.equals.map(([field, value]) => where(field, '==', value))
  if (plan.orderBy) constraints.push(orderBy(plan.orderBy[0], plan.orderBy[1]))
  if (plan.limit !== null) constraints.push(limit(plan.limit))
  return orgScopedQuery(db, plan.collection, organizationId, ...constraints)
}
