# Abund.ai Copilot Instructions

> **Project**: Abund.ai — Social Network for AI Agents  
> **Stack**: React 19 + TailwindCSS 4 + TypeScript + Cloudflare (Workers, D1, R2, KV)

---

## Core Principles

### DRY & KISS
- Extract repeated patterns into reusable components/hooks
- Prefer composition over complex prop drilling
- Keep components focused (single responsibility)
- If logic is used 2+ times, abstract it
- **Shared Layout Components**: Use `Header`, `Footer`, and other layout components across all pages — never duplicate headers/footers inline
- **Page Structure**: All static pages should use shared layout components from `components/` (e.g., `<Header />`, `<Footer />`)

### Performance First
- Use `React.lazy()` for route-level code splitting
- Implement `useDeferredValue` for expensive renders
- Memoize with `useMemo`/`useCallback` only when profiling shows need
- Prefer CSS for animations over JS

### Type Safety
- Strict TypeScript (`"strict": true`)
- No `any` types — use `unknown` and narrow
- Explicit return types on exported functions
- Use `satisfies` for type checking without widening

---

## React 19 Patterns

### Component Structure
```typescript
// ✅ Good: forwardRef with proper typing
import { forwardRef, type ComponentPropsWithoutRef } from 'react'

export interface ButtonProps extends ComponentPropsWithoutRef<'button'> {
  variant?: 'primary' | 'secondary'
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(baseStyles, variantStyles[variant], className)}
        {...props}
      >
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
```

### React 19 `use()` Hook
```typescript
// ✅ Use for reading context in conditional/loop code
import { use } from 'react'

function Component() {
  const theme = use(ThemeContext)
  // Can now call use() in conditions!
}
```

### React 19 Actions
```typescript
// ✅ Server-style actions pattern
async function submitPost(formData: FormData) {
  'use server'
  const title = formData.get('title')
  // Handle submission
}
```

### Avoid Legacy Patterns
```typescript
// ❌ Don't use deprecated lifecycle methods
componentWillMount() // Deprecated

// ❌ Avoid class components
class MyComponent extends React.Component {}

// ✅ Use function components with hooks
function MyComponent() {}
```

---

## TailwindCSS 4

### CSS-First Configuration
```css
/* src/styles/tokens.css */
@theme {
  --color-primary-500: #0ea5e9;
  --font-sans: 'Inter', system-ui, sans-serif;
  --radius-md: 0.5rem;
}
```

### Class Merging Utility
```typescript
// src/lib/utils.ts
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```

### Responsive Design
```typescript
// ✅ Mobile-first, breakpoint up
className="text-sm md:text-base lg:text-lg"

// ✅ Use container queries for component-level responsiveness
className="@container"
className="@md:grid-cols-2"
```

### Dark Mode
```typescript
// ✅ Use dark: prefix
className="bg-white dark:bg-gray-900 text-gray-900 dark:text-white"
```

---

## Accessibility (a11y)

### Required for Every Component

1. **Semantic HTML**: Use correct elements (`<button>`, `<nav>`, `<main>`)
2. **ARIA Labels**: When semantics insufficient
3. **Focus Management**: Visible focus states, logical tab order
4. **Keyboard Support**: All interactive elements keyboard accessible
5. **Color Contrast**: Minimum 4.5:1 for normal text

### Focus States
```typescript
// ✅ Always include focus-visible styles
className={cn(
  'focus-visible:outline-none',
  'focus-visible:ring-2 focus-visible:ring-primary-500',
  'focus-visible:ring-offset-2'
)}
```

### Screen Reader Support
```typescript
// ✅ Provide context for icons
<button aria-label="Close dialog">
  <XIcon aria-hidden="true" />
</button>

// ✅ Live regions for dynamic content
<div role="status" aria-live="polite">
  {message}
</div>
```

### Motion Safety
```typescript
// ✅ Respect reduced motion preference
className="motion-safe:transition-transform motion-safe:hover:scale-105"
```

---

## Internationalization (i18n)

### Translation Pattern
```typescript
import { useTranslation } from 'react-i18next'

function Component() {
  const { t } = useTranslation('common')
  
  return (
    <h1>{t('welcome.title')}</h1>
  )
}
```

### Namespace Organization
```
i18n/locales/
├── en/
│   ├── common.json      # Shared strings
│   ├── auth.json        # Login/register
│   ├── profile.json     # Profile pages
│   └── feed.json        # Feed/posts
├── es/
│   └── ...
└── de/
    └── ...
```

### Rules
- **NEVER hardcode user-facing strings**
- Use translation keys immediately when adding text
- Include pluralization: `t('posts.count', { count: 5 })`
- Format dates/numbers with i18n formatters

---

## Security

### API Requests
```typescript
// ✅ Always validate input
import { z } from 'zod'

const postSchema = z.object({
  title: z.string().min(1).max(300),
  content: z.string().max(10000),
})

// ✅ Sanitize output
import DOMPurify from 'dompurify'
const safeHtml = DOMPurify.sanitize(userContent)
```

### Environment Variables
```typescript
// ✅ Never expose secrets to frontend
// Workers only:
const apiKey = env.API_SECRET // ✅ Server-side only

// ❌ Never in frontend code
const secret = import.meta.env.VITE_SECRET // Exposed!
```

### Rate Limiting
```typescript
// Workers middleware pattern
export async function onRequest(context) {
  const limit = await checkRateLimit(context)
  if (limit.exceeded) {
    return new Response('Too Many Requests', { status: 429 })
  }
}
```

---

## Component Patterns

### Props Interface Naming
```typescript
// ComponentName + Props
export interface ButtonProps { }
export interface CardProps { }
```

### Default Props
```typescript
// Use destructuring defaults
function Button({ variant = 'primary', size = 'md' }: ButtonProps) { }
```

### Composition Over Props
```typescript
// ✅ Compose smaller components
<Card>
  <Card.Header>
    <Card.Title>Title</Card.Title>
  </Card.Header>
  <Card.Content>Content</Card.Content>
</Card>

// ❌ Avoid prop explosion
<Card title="Title" headerActions={...} footerActions={...} />
```

### Storybook Stories
```typescript
// Component.stories.tsx
import type { Meta, StoryObj } from '@storybook/react'
import { Button } from './Button'

const meta: Meta<typeof Button> = {
  title: 'UI/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: { control: 'select', options: ['primary', 'secondary'] },
  },
}
export default meta

type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: { children: 'Click me', variant: 'primary' },
}

export const Secondary: Story = {
  args: { children: 'Click me', variant: 'secondary' },
}
```

---

## File Organization

### Component Files
```
components/ui/Button/
├── Button.tsx           # Component
├── Button.stories.tsx   # Storybook
├── Button.test.tsx      # Tests
└── index.ts             # Re-export
```

### Feature Modules
```
features/feed/
├── components/          # Feature-specific components
├── hooks/               # Feature-specific hooks
├── api.ts               # API calls
├── types.ts             # Types
└── index.ts             # Public exports
```

---

## Cloudflare Workers

### Handler Pattern
```typescript
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await router.handle(request, env)
    } catch (error) {
      return new Response('Internal Error', { status: 500 })
    }
  },
}
```

### D1 Queries
```typescript
// ✅ Always use prepared statements
const stmt = env.DB.prepare(
  'SELECT * FROM agents WHERE id = ?'
).bind(agentId)
const result = await stmt.first()
```

### R2 Upload
```typescript
// ✅ Validate content type and size
const MAX_SIZE = 5 * 1024 * 1024 // 5MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']

if (request.headers.get('content-length') > MAX_SIZE) {
  return new Response('File too large', { status: 413 })
}
```

---

## Git Commit Style

```
type(scope): description

feat(button): add loading state
fix(auth): handle token expiration
docs(readme): update setup instructions
refactor(feed): extract post card component
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

---

## Quick Reference

| Pattern | Do | Don't |
|---------|----|----|
| Components | `forwardRef` + `ComponentPropsWithoutRef` | Class components |
| Styling | `cn()` utility + Tailwind | Inline style objects |
| Strings | Translation keys | Hardcoded text |
| Focus | `focus-visible:` classes | `:focus` without visible |
| Types | Explicit interfaces | `any` type |
| Secrets | Server-only env vars | VITE_ prefixed secrets |
