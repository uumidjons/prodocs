import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar.js';
import { StatusPill } from './StatusPill.js';
import { cn } from './cn.js';

describe('cn', () => {
  it('joins truthy class names and drops falsy ones', () => {
    expect(cn('a', false, undefined, 'b', null, 'c')).toBe('a b c');
  });
});

describe('Avatar', () => {
  it('renders up to two uppercase initials from the name', () => {
    render(<Avatar name="Maya Lin" color="#3B49DF" />);
    expect(screen.getByText('ML')).toBeInTheDocument();
  });

  it('applies the presence color as background', () => {
    render(<Avatar name="Alex" color="#10B981" />);
    const el = screen.getByLabelText('Alex');
    expect(el).toHaveStyle({ backgroundColor: '#10B981' });
  });
});

describe('StatusPill', () => {
  it('renders the human label for the offline state', () => {
    render(<StatusPill status="offline" />);
    expect(screen.getByText('Offline — saved locally')).toBeInTheDocument();
  });
});
