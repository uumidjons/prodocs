import type {
  AddMemberInput,
  AssignableRole,
  AuthResultDto,
  CreateDocumentInput,
  DocumentDto,
  DocumentView,
  LoginInput,
  MemberDto,
  RegisterInput,
  TemplateDto,
  UpdateDocumentInput,
  UserDto,
  UserSearchResultDto,
} from '@scribe/shared';
import { request, setAccessToken } from './client.js';

/** Typed API surface. Every response type comes from @scribe/shared, so the
 *  client cannot drift from the server contract. */
export const api = {
  auth: {
    async register(input: RegisterInput): Promise<AuthResultDto> {
      const res = await request<AuthResultDto>('/auth/register', {
        method: 'POST',
        body: input,
        skipRefresh: true,
      });
      setAccessToken(res.accessToken);
      return res;
    },
    async login(input: LoginInput): Promise<AuthResultDto> {
      const res = await request<AuthResultDto>('/auth/login', {
        method: 'POST',
        body: input,
        skipRefresh: true,
      });
      setAccessToken(res.accessToken);
      return res;
    },
    /** Attempt to restore a session from the refresh cookie on app load. */
    async restore(): Promise<AuthResultDto | null> {
      try {
        const res = await request<AuthResultDto>('/auth/refresh', {
          method: 'POST',
          skipRefresh: true,
        });
        setAccessToken(res.accessToken);
        return res;
      } catch {
        return null;
      }
    },
    me(): Promise<UserDto> {
      return request<UserDto>('/auth/me');
    },
    async logout(): Promise<void> {
      await request<void>('/auth/logout', { method: 'POST', skipRefresh: true });
      setAccessToken(null);
    },
  },
  documents: {
    /** List the current user's documents scoped to a sidebar section. */
    list(view: DocumentView = 'mine'): Promise<DocumentDto[]> {
      return request<DocumentDto[]>(`/documents?view=${view}`);
    },
    create(input: CreateDocumentInput = {}): Promise<DocumentDto> {
      return request<DocumentDto>('/documents', { method: 'POST', body: input });
    },
    get(id: string): Promise<DocumentDto> {
      return request<DocumentDto>(`/documents/${id}`);
    },
    updateTitle(id: string, input: UpdateDocumentInput): Promise<DocumentDto> {
      return request<DocumentDto>(`/documents/${id}`, { method: 'PATCH', body: input });
    },
    /** Move a document to Trash (soft delete — reversible via restore). */
    remove(id: string): Promise<void> {
      return request<void>(`/documents/${id}`, { method: 'DELETE' });
    },
    /** Restore a document from Trash back to Documents. */
    restore(id: string): Promise<void> {
      return request<void>(`/documents/${id}/restore`, { method: 'POST' });
    },
    /** Permanently delete a document (irreversible). */
    purge(id: string): Promise<void> {
      return request<void>(`/documents/${id}/permanent`, { method: 'DELETE' });
    },
    members: {
      list(documentId: string): Promise<MemberDto[]> {
        return request<MemberDto[]>(`/documents/${documentId}/members`);
      },
      add(documentId: string, input: AddMemberInput): Promise<MemberDto[]> {
        return request<MemberDto[]>(`/documents/${documentId}/members`, {
          method: 'POST',
          body: input,
        });
      },
      changeRole(documentId: string, userId: string, role: AssignableRole): Promise<MemberDto[]> {
        return request<MemberDto[]>(`/documents/${documentId}/members/${userId}`, {
          method: 'PATCH',
          body: { role },
        });
      },
      remove(documentId: string, userId: string): Promise<MemberDto[]> {
        return request<MemberDto[]>(`/documents/${documentId}/members/${userId}`, {
          method: 'DELETE',
        });
      },
    },
  },
  templates: {
    /** System templates for the "New document → From template" picker. */
    list(): Promise<TemplateDto[]> {
      return request<TemplateDto[]>('/templates');
    },
  },
  users: {
    search(q: string): Promise<UserSearchResultDto[]> {
      return request<UserSearchResultDto[]>(`/users/search?q=${encodeURIComponent(q)}`);
    },
  },
};

export { ApiError, getValidAccessToken, setOnAuthFailure } from './client.js';
