export type UserRole = 'CUSTOMER' | 'DRIVER' | 'MERCHANT' | 'ADMIN';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  role: UserRole;
}
