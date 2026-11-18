import { collection, query, where, type Firestore, type Query, type QueryConstraint } from 'firebase/firestore'

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
