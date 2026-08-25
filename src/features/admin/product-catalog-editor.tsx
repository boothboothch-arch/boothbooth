"use client";

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { removeProductAction, saveProductAction } from "./actions";
import { Button } from "@/shared/ui/button";

export type CatalogOptionValue = {
  id: string;
  label: string;
  priceDelta: number;
  sortOrder: number;
  active: boolean;
};

export type CatalogOptionGroup = {
  id: string;
  name: string;
  selectionType: "single" | "multiple";
  required: boolean;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  active: boolean;
  values: CatalogOptionValue[];
};

export type CatalogProduct = {
  id?: string;
  name: string;
  description: string;
  itemType: "shirt" | "bag";
  unitPrice: number;
  stockLimit: number | null;
  sortOrder: number;
  active: boolean;
  soldCount: number;
  optionGroups: CatalogOptionGroup[];
  customizationConfig: {
    initialEnabled: boolean;
    stickerEnabled: boolean;
    referenceImagesEnabled: boolean;
    extraRequestEnabled: boolean;
  };
};

function newValue(sortOrder = 0): CatalogOptionValue {
  return { id: crypto.randomUUID(), label: "", priceDelta: 0, sortOrder, active: true };
}

function newGroup(sortOrder = 0): CatalogOptionGroup {
  return {
    id: crypto.randomUUID(), name: "", selectionType: "single", required: false,
    minSelections: 0, maxSelections: 1, sortOrder, active: true, values: [newValue()],
  };
}

export function ProductCatalogEditor({ saleId, product }: { saleId: string; product: CatalogProduct }) {
  const [groups, setGroups] = useState(product.optionGroups);
  const [customization, setCustomization] = useState(product.customizationConfig);

  function patchGroup(index: number, patch: Partial<CatalogOptionGroup>) {
    setGroups((current) => current.map((group, groupIndex) => groupIndex === index ? { ...group, ...patch } : group));
  }

  function patchValue(groupIndex: number, valueIndex: number, patch: Partial<CatalogOptionValue>) {
    setGroups((current) => current.map((group, currentGroupIndex) => currentGroupIndex !== groupIndex ? group : {
      ...group,
      values: group.values.map((option, currentValueIndex) => currentValueIndex === valueIndex ? { ...option, ...patch } : option),
    }));
  }

  return (
    <article className="admin-panel product-editor">
      <form action={saveProductAction}>
        <input type="hidden" name="saleId" value={saleId} />
        <input type="hidden" name="productId" value={product.id ?? ""} />
        <input type="hidden" name="optionGroups" value={JSON.stringify(groups)} />
        <input type="hidden" name="customizationConfig" value={JSON.stringify(customization)} />
        <div className="product-editor__heading">
          <div><h2>{product.id ? product.name : "새 상품"}</h2>{product.id && <span>판매 {product.soldCount}개</span>}</div>
          <label className="checkbox admin-switch"><input name="active" type="checkbox" defaultChecked={product.active} /><span><strong>판매 활성화</strong></span></label>
        </div>

        <div className="form-grid">
          <div className="field"><label>상품명</label><input name="name" defaultValue={product.name} required /></div>
          <div className="field"><label>상품 유형</label><select name="itemType" defaultValue={product.itemType}><option value="shirt">티셔츠</option><option value="bag">가방</option></select></div>
          <div className="field"><label>기본 가격</label><input name="unitPrice" type="number" min="0" step="100" defaultValue={product.unitPrice} required /></div>
          <div className="field"><label>한정 수량</label><input name="stockLimit" type="number" min={product.soldCount} placeholder="비우면 무제한" defaultValue={product.stockLimit ?? ""} /><span className="field__hint">현재 판매량보다 작게 설정할 수 없습니다.</span></div>
          <div className="field"><label>노출 순서</label><input name="sortOrder" type="number" min="0" defaultValue={product.sortOrder} required /></div>
          <div className="field field--full"><label>상품 설명</label><textarea name="description" defaultValue={product.description} placeholder="고객 주문서에 표시할 설명" /></div>
        </div>

        <section className="product-editor__customization">
          <h3>주문 입력 항목</h3>
          <div className="product-editor__switches">
            {([
              ["initialEnabled", "이니셜"], ["stickerEnabled", "스티커"],
              ["referenceImagesEnabled", "디자인 참고 이미지"], ["extraRequestEnabled", "기타 요청사항"],
            ] as const).map(([key, label]) => <label className="checkbox" key={key}><input type="checkbox" checked={customization[key]} onChange={(event) => setCustomization((current) => ({ ...current, [key]: event.target.checked }))} /><span>{label}</span></label>)}
          </div>
        </section>

        <section className="product-editor__options">
          <div className="product-editor__section-heading"><div><h3>옵션 그룹</h3><p>사이즈, 인쇄 방식, 단면·양면처럼 필요한 옵션을 만듭니다.</p></div><Button type="button" variant="secondary" onClick={() => setGroups((current) => [...current, newGroup(current.length)])}><Plus size={14} /> 그룹 추가</Button></div>
          {groups.map((group, groupIndex) => (
            <div className="option-group-editor" key={group.id}>
              <div className="option-group-editor__heading">
                <input aria-label="옵션 그룹명" value={group.name} placeholder="예: 인쇄 방식" onChange={(event) => patchGroup(groupIndex, { name: event.target.value })} />
                <select aria-label="선택 방식" value={group.selectionType} onChange={(event) => patchGroup(groupIndex, { selectionType: event.target.value as CatalogOptionGroup["selectionType"], maxSelections: event.target.value === "single" ? 1 : Math.max(1, group.maxSelections) })}><option value="single">하나 선택</option><option value="multiple">여러 개 선택</option></select>
                <label className="checkbox"><input type="checkbox" checked={group.required} onChange={(event) => patchGroup(groupIndex, { required: event.target.checked, minSelections: event.target.checked ? Math.max(1, group.minSelections) : 0 })} /><span>필수</span></label>
                <button type="button" aria-label="옵션 그룹 삭제" onClick={() => setGroups((current) => current.filter((_, index) => index !== groupIndex))}><Trash2 size={15} /></button>
              </div>
              {group.selectionType === "multiple" && <div className="option-group-editor__limits"><label>최소 <input type="number" min="0" value={group.minSelections} onChange={(event) => patchGroup(groupIndex, { minSelections: Number(event.target.value) })} /></label><label>최대 <input type="number" min="1" value={group.maxSelections} onChange={(event) => patchGroup(groupIndex, { maxSelections: Number(event.target.value) })} /></label></div>}
              <div className="option-value-list">
                {group.values.map((option, valueIndex) => <div className="option-value-editor" key={option.id}>
                  <input aria-label="선택값 이름" value={option.label} placeholder="예: 앞면 + 뒷면" onChange={(event) => patchValue(groupIndex, valueIndex, { label: event.target.value })} />
                  <label><span>추가금</span><input type="number" min="0" step="100" value={option.priceDelta} onChange={(event) => patchValue(groupIndex, valueIndex, { priceDelta: Number(event.target.value) })} /></label>
                  <button type="button" aria-label="선택값 삭제" disabled={group.values.length === 1} onClick={() => patchGroup(groupIndex, { values: group.values.filter((_, index) => index !== valueIndex) })}><Trash2 size={14} /></button>
                </div>)}
              </div>
              <Button type="button" variant="ghost" onClick={() => patchGroup(groupIndex, { values: [...group.values, newValue(group.values.length)] })}><Plus size={13} /> 선택값 추가</Button>
            </div>
          ))}
        </section>

        <div className="form-actions"><Button type="submit">{product.id ? "상품 저장" : "상품 추가"}</Button></div>
      </form>
      {product.id && <form action={removeProductAction} onSubmit={(event) => { if (!window.confirm("이 상품을 삭제하거나 숨길까요? 주문 이력이 있으면 숨김 처리됩니다.")) event.preventDefault(); }}><input type="hidden" name="saleId" value={saleId} /><input type="hidden" name="productId" value={product.id} /><Button type="submit" variant="ghost"><Trash2 size={14} /> 상품 삭제·숨김</Button></form>}
    </article>
  );
}
