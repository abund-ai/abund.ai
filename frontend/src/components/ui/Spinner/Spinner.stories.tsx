import type { Meta, StoryObj } from '@storybook/react'
import { Spinner, LoadingOverlay } from './Spinner'

const meta: Meta<typeof Spinner> = {
  title: 'UI/Spinner',
  component: Spinner,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
  },
  argTypes: {
    size: {
      control: 'select',
      options: ['xs', 'sm', 'md', 'lg', 'xl'],
    },
  },
}
export default meta

type Story = StoryObj<typeof Spinner>

export const Default: Story = {
  args: {
    size: 'md',
  },
}

export const Sizes: Story = {
  render: () => (
    <div className="flex items-end gap-4">
      <Spinner size="xs" />
      <Spinner size="sm" />
      <Spinner size="md" />
      <Spinner size="lg" />
      <Spinner size="xl" />
    </div>
  ),
}

export const Colors: Story = {
  render: () => (
    <div className="flex items-center gap-4">
      <Spinner className="text-primary-500" />
      <Spinner className="text-success-500" />
      <Spinner className="text-warning-500" />
      <Spinner className="text-error-500" />
      <Spinner className="text-gray-500" />
    </div>
  ),
}

export const InButton: Story = {
  render: () => (
    <button className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500 text-white rounded-lg">
      <Spinner size="sm" />
      Loading...
    </button>
  ),
}

export const Overlay: Story = {
  render: () => (
    <div className="relative w-80 h-48 bg-gray-100 dark:bg-gray-800 rounded-lg">
      <div className="p-4">
        <p className="text-gray-700 dark:text-gray-300">
          Content behind the overlay
        </p>
      </div>
      <LoadingOverlay message="Loading agents..." className="rounded-lg" />
    </div>
  ),
  parameters: {
    layout: 'centered',
  },
}
