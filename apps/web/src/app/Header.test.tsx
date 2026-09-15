import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '../stores/authStore.js';
import { useUiStore } from '../stores/uiStore.js';
import { Header } from './Header.js';

/**
 * Profile dropdown behavior (task §7): opens on click, closes on a second click, on an
 * outside pointer press, and on Escape — while preserving the user identity + Sign out.
 */
const logoutMock = vi.fn();

function seedUser() {
  useAuthStore.setState({
    user: {
      id: 'u1',
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      color: '#3B49DF',
      createdAt: new Date().toISOString(),
    },
    status: 'authenticated',
    error: null,
    logout: logoutMock,
  });
  useUiStore.setState({ activeDocument: null, connectionStatus: null, presence: [] });
}

function renderHeader() {
  return render(
    <MemoryRouter>
      <Header />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  logoutMock.mockReset();
  seedUser();
});
afterEach(() => vi.restoreAllMocks());

const openMenu = () => fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/i }));

describe('Header profile dropdown', () => {
  it('shows the user name and email when open', () => {
    renderHeader();
    openMenu();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('ada@example.com')).toBeInTheDocument();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
  });

  it('closes on a second click of the profile button', () => {
    renderHeader();
    openMenu();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    openMenu();
    expect(screen.queryByText('Sign out')).not.toBeInTheDocument();
  });

  it('closes when clicking outside the menu', () => {
    renderHeader();
    openMenu();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText('Sign out')).not.toBeInTheDocument();
  });

  it('closes on Escape', () => {
    renderHeader();
    openMenu();
    expect(screen.getByText('Sign out')).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText('Sign out')).not.toBeInTheDocument();
  });

  it('still triggers Sign out', () => {
    renderHeader();
    openMenu();
    fireEvent.click(screen.getByText('Sign out'));
    expect(logoutMock).toHaveBeenCalledTimes(1);
  });
});
