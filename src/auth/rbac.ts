// Role-based access control for the control surface.
// Roles are bundles of permissions; routes check permissions, never role names,
// so adding a role later does not mean touching every route.
export type Role = 'admin' | 'operator' | 'viewer';

export type Permission =
  | 'usage:read'
  | 'providers:read'
  | 'drivers:read'
  | 'keys:read'
  | 'keys:write'
  | 'tenants:read'
  | 'tenants:write'
  | 'platform:all-tenants'; // see and manage every tenant, not just your own

const VIEWER: Permission[] = ['usage:read', 'providers:read', 'drivers:read'];
const OPERATOR: Permission[] = [...VIEWER, 'keys:read', 'keys:write', 'tenants:read'];
const ADMIN: Permission[] = [...OPERATOR, 'tenants:write', 'platform:all-tenants'];

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  viewer: new Set(VIEWER),
  operator: new Set(OPERATOR),
  admin: new Set(ADMIN),
};

export function can(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
