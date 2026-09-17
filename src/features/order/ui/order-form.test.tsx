import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OrderForm } from './order-form'
import type { ProductConfig, ProductOptionGroup } from '../domain/order'

vi.mock('next/script', () => ({ default: () => null }))
afterEach(cleanup)

it('shows option groups and values in catalog order even when stored sortOrder values disagree', () => {
  const size: ProductOptionGroup = {
    id: crypto.randomUUID(), name: '사이즈', selectionType: 'single',
    required: true, minSelections: 1, maxSelections: 1, sortOrder: 9, active: true,
    values: ['아동 S', '아동 M', '아동 L', '아동 XL'].map((label, index) => ({
      id: crypto.randomUUID(), label, priceDelta: 0, active: true,
      sortOrder: [3, 5, 6, 0][index],
    })),
  }
  const extras: ProductOptionGroup = {
    ...size, id: crypto.randomUUID(), name: '추가 옵션', selectionType: 'multiple',
    sortOrder: 0, maxSelections: 2,
    values: [
      { id: crypto.randomUUID(), label: '앞면', priceDelta: 0, active: true, sortOrder: 8 },
      { id: crypto.randomUUID(), label: '숨김', priceDelta: 0, active: false, sortOrder: 1 },
      { id: crypto.randomUUID(), label: '뒷면', priceDelta: 1000, active: true, sortOrder: 0 },
    ],
  }
  const product: ProductConfig = {
    id: crypto.randomUUID(), type: 'shirt', name: '테스트 상품', description: '', unitPrice: 30000,
    stockLimit: null, remainingStock: null, optionGroups: [size, extras],
    customization: { initialEnabled: false, stickerEnabled: false, referenceImagesEnabled: false, extraRequestEnabled: false },
  }
  render(<OrderForm products={[product]} serverNow={new Date().toISOString()}
    hardExpiresAt={new Date(Date.now() + 30 * 60_000).toISOString()}
    shippingFee={3000} freeShippingThreshold={80000} remoteAreaSurcharge={0} remotePostalRanges={[]} />)

  const select = screen.getByRole('combobox', { name: '사이즈' })
  expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual([
    '선택해주세요', '아동 S', '아동 M', '아동 L', '아동 XL',
  ])
  expect(select).toHaveValue(size.values[0].id)
  const groups = screen.getAllByRole('group').filter(group => group.classList.contains('option-choice-field'))
  expect(groups.map(group => group.querySelector('legend')?.textContent)).toEqual(['사이즈*필수', '추가 옵션*필수'])
  const checkboxes = within(groups[1]).getAllByRole('checkbox')
  expect(checkboxes[0]).toHaveAccessibleName('앞면')
  expect(checkboxes[0]).toBeChecked()
  expect(checkboxes[1]).toHaveAccessibleName(/뒷면/)
  expect(checkboxes[1]).not.toBeChecked()
  expect(screen.queryByText('숨김')).not.toBeInTheDocument()
})
