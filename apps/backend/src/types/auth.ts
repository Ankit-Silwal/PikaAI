export interface PublicUser {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
}

export interface TokenIdentity {
  userId: string;
  tokenId: string;
  expiresAt: number;
  epoch: string;
}

export interface AuthContext extends TokenIdentity {
  user: PublicUser;
}

export interface ClientActivity {
  ip: string;
  userAgent: string;
}

export interface AuthState {
  ping(): Promise<void>;
  getEpoch(): Promise<string>;
  isAllowed(epoch: string, tokenId: string): Promise<boolean>;
  revoke(tokenId: string, expiresAt: number): Promise<void>;
  recordActivity(userId: string, activity: ClientActivity, login?: boolean): Promise<void>;
  getActivity(userId: string): Promise<Record<string, string>>;
}
