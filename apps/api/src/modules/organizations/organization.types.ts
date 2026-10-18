import type {
  Organization,
  OrganizationJoinPolicy,
  OrganizationMembership,
} from "../../generated/prisma/client.js";
import type { AuthUser } from "../auth/auth.types.js";

export type CreateOrganizationInput = {
  name: string;
  joinPolicy: OrganizationJoinPolicy;
};

export type PublicOrganization = Omit<Organization, "invite_code">;
export type OrganizationMember = OrganizationMembership;
export type OrganizationLocals = { user: AuthUser };

export type CreateOrganizationResponse = {
  organization: PublicOrganization;
  inviteCode: string;
};

export type JoinOrganizationResponse = {
  organization: PublicOrganization;
  membership: OrganizationMember;
};

export type MembershipResponse = { membership: OrganizationMember };
export type InviteCodeResponse = { inviteCode: string };
export type MembersResponse = {
  members: (OrganizationMember & { user: Pick<AuthUser, "email"> })[];
};
