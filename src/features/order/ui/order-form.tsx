"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Script from "next/script";
import { zodResolver } from "@hookform/resolvers/zod";
import { useFieldArray, useForm } from "react-hook-form";
import {
  Camera,
  Clock3,
  ImagePlus,
  MailCheck,
  MapPin,
  Plus,
  Search,
  ShoppingBag,
  Shirt,
  Trash2,
  Truck,
} from "lucide-react";
import { Button } from "@/shared/ui/button";
import { prepareImage, type ImageDraft } from "../client-image";
import {
  INITIAL_TEXT_LIMIT,
  itemPrice,
  limitInitialTextInput,
  orderTotals,
  type PostalCodeRange,
  type ProductConfig,
} from "../domain/order";
import { orderFormSchema, type OrderFormInput } from "../schemas";

type PostcodeConstructor = new (options: {
  oncomplete: (data: { zonecode: string; address: string }) => void;
}) => { open: () => void };

declare global {
  interface Window {
    kakao?: { Postcode: PostcodeConstructor };
    daum?: { Postcode: PostcodeConstructor };
  }
}

type Props = {
  hardExpiresAt: string;
  serverNow: string;
  products: ProductConfig[];
  shippingFee: number;
  freeShippingThreshold: number;
  remoteAreaSurcharge: number;
  remotePostalRanges: PostalCodeRange[];
};
class ImageUploadError extends Error {
  constructor(
    public readonly clientId: string,
    message: string,
  ) {
    super(message);
    this.name = "ImageUploadError";
  }
}

function remainingLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function itemDefaults(product: ProductConfig): OrderFormInput["items"][number] {
  const selectedOptionValueIds = product.optionGroups
    .filter((group) => group.active)
    .flatMap((group) => {
      const activeValues = group.values
        .filter((option) => option.active)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const minimum = group.required
        ? Math.max(1, group.minSelections)
        : group.minSelections;
      return activeValues.slice(0, minimum).map((option) => option.id);
    });
  return {
    clientId: crypto.randomUUID(),
    productId: product.id,
    itemType: product.type,
    selectedOptionValueIds,
    initialText: "",
    stickerSelected: false,
    stickerCategories: "",
    extraRequest: "",
    images: [],
  };
}

export function OrderForm({
  hardExpiresAt,
  serverNow,
  products,
  shippingFee,
  freeShippingThreshold,
  remoteAreaSurcharge,
  remotePostalRanges,
}: Props) {
  const firstProduct =
    products.find(
      (product) =>
        product.remainingStock === null || product.remainingStock > 0,
    ) ?? products[0];
  const [now, setNow] = useState(() => Date.parse(serverNow));
  const [idleWarning, setIdleWarning] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [uploadLabel, setUploadLabel] = useState("");
  const [images, setImages] = useState<Record<string, ImageDraft[]>>({});
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [postcodeError, setPostcodeError] = useState("");
  const imagesRef = useRef(images);
  const clockOffset = useRef(Date.parse(serverNow) - Date.now());
  const activityAt = useRef(Date.now());
  const warnedAt = useRef<number | null>(null);
  const idempotencyKey = useRef(crypto.randomUUID());
  const uploadedByLocalId = useRef<Record<string, string>>({});
  const form = useForm<OrderFormInput>({
    resolver: zodResolver(orderFormSchema),
    defaultValues: {
      customerName: "",
      phone: "",
      email: "",
      depositorName: "",
      fulfillmentType: "shipping",
      postalCode: "",
      address: "",
      addressDetail: "",
      cashReceiptType: "none",
      cashReceiptIdentifier: "",
      items: [itemDefaults(firstProduct)],
      privacyConsent: false,
      customOrderConsent: false,
      website: "",
    },
  });
  const items = useFieldArray({
    control: form.control,
    name: "items",
    keyName: "fieldKey",
  });
  const watchedItems = form.watch("items");
  const fulfillmentType = form.watch("fulfillmentType");
  const postalCode = form.watch("postalCode");
  const baseAddress = form.watch("address");
  const cashReceiptType = form.watch("cashReceiptType");
  const totals = useMemo(
    () =>
      orderTotals(products, watchedItems, fulfillmentType, {
        shippingFee,
        freeShippingThreshold,
        remoteAreaSurcharge,
        postalCode,
        remotePostalRanges,
      }),
    [
      freeShippingThreshold,
      fulfillmentType,
      products,
      postalCode,
      remoteAreaSurcharge,
      remotePostalRanges,
      shippingFee,
      watchedItems,
    ],
  );
  const remaining = useMemo(
    () => Date.parse(hardExpiresAt) - now,
    [hardExpiresAt, now],
  );
  const totalImages = Object.values(images).reduce(
    (sum, entries) => sum + entries.length,
    0,
  );

  useEffect(() => {
    imagesRef.current = images;
  }, [images]);
  useEffect(
    () => () =>
      Object.values(imagesRef.current)
        .flat()
        .forEach((image) => URL.revokeObjectURL(image.preview)),
    [],
  );

  const releaseAndLeave = useCallback(async (message: string) => {
    await fetch("/api/reservations/release", {
      method: "POST",
      keepalive: true,
    }).catch(() => undefined);
    window.alert(message);
    window.location.assign("/");
  }, []);

  useEffect(() => {
    const markActivity = () => {
      activityAt.current = Date.now();
      warnedAt.current = null;
      setIdleWarning(false);
    };
    const events: (keyof WindowEventMap)[] = [
      "pointerdown",
      "keydown",
      "input",
    ];
    events.forEach((event) =>
      window.addEventListener(event, markActivity, { passive: true }),
    );
    const timer = window.setInterval(() => {
      const clientNow = Date.now();
      const serverCurrent = clientNow + clockOffset.current;
      setNow(serverCurrent);
      const idle = clientNow - activityAt.current;
      if (idle >= 5 * 60_000 && !warnedAt.current) {
        warnedAt.current = clientNow;
        setIdleWarning(true);
      }
      if (idle >= 6 * 60_000)
        void releaseAndLeave("오랫동안 활동이 없어 주문서가 종료되었어요.");
      if (serverCurrent >= Date.parse(hardExpiresAt))
        void releaseAndLeave("30분의 주문서 작성 시간이 끝났어요.");
    }, 1_000);
    const heartbeat = window.setInterval(async () => {
      if (Date.now() - activityAt.current >= 5 * 60_000) return;
      const response = await fetch("/api/reservations/heartbeat", {
        method: "POST",
      });
      if (!response.ok)
        void releaseAndLeave("주문 자리가 만료되었어요. 다시 입장해주세요.");
    }, 30_000);
    const releaseOnClose = () => {
      if (!submitting)
        void fetch("/api/reservations/release", {
          method: "POST",
          keepalive: true,
        });
    };
    window.addEventListener("pagehide", releaseOnClose);
    return () => {
      events.forEach((event) =>
        window.removeEventListener(event, markActivity),
      );
      window.clearInterval(timer);
      window.clearInterval(heartbeat);
      window.removeEventListener("pagehide", releaseOnClose);
    };
  }, [hardExpiresAt, releaseAndLeave, submitting]);

  function openPostcode() {
    const Postcode = window.kakao?.Postcode ?? window.daum?.Postcode;
    if (!Postcode) {
      setPostcodeError(
        "주소 검색을 불러오지 못했어요. 인터넷 연결을 확인한 후 다시 시도해주세요.",
      );
      return;
    }
    setPostcodeError("");
    new Postcode({
      oncomplete: (data) => {
        form.setValue("postalCode", data.zonecode, { shouldValidate: true });
        form.setValue("address", data.address, { shouldValidate: true });
        form.setValue("addressDetail", "", { shouldValidate: false });
        window.requestAnimationFrame(() => form.setFocus("addressDetail"));
      },
    }).open();
  }

  async function addImages(clientId: string, selected: FileList | null) {
    if (!selected?.length) return;
    setImageErrors((state) => {
      const next = { ...state };
      delete next[clientId];
      return next;
    });
    const current = images[clientId] ?? [];
    const files = Array.from(selected).slice(
      0,
      Math.max(0, Math.min(3 - current.length, 20 - totalImages)),
    );
    try {
      const prepared: ImageDraft[] = [];
      for (const file of files) prepared.push(await prepareImage(file));
      setImages((state) => ({
        ...state,
        [clientId]: [...(state[clientId] ?? []), ...prepared],
      }));
    } catch (error) {
      setImageErrors((state) => ({
        ...state,
        [clientId]:
          error instanceof Error
            ? error.message
            : "이미지를 처리하지 못했어요.",
      }));
    }
  }

  function removeImage(clientId: string, localId: string) {
    setImageErrors((state) => {
      const next = { ...state };
      delete next[clientId];
      return next;
    });
    const uploadedId = uploadedByLocalId.current[localId];
    if (uploadedId) {
      delete uploadedByLocalId.current[localId];
      void fetch("/api/order-images", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: uploadedId }),
      });
    }
    setImages((state) => {
      const target = state[clientId]?.find(
        (image) => image.localId === localId,
      );
      if (target) URL.revokeObjectURL(target.preview);
      return {
        ...state,
        [clientId]: (state[clientId] ?? []).filter(
          (image) => image.localId !== localId,
        ),
      };
    });
  }

  function removeItem(index: number, clientId: string) {
    for (const image of images[clientId] ?? []) {
      URL.revokeObjectURL(image.preview);
      const uploadedId = uploadedByLocalId.current[image.localId];
      if (uploadedId) {
        delete uploadedByLocalId.current[image.localId];
        void fetch("/api/order-images", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: uploadedId }),
        });
      }
    }
    setImages((state) => {
      const next = { ...state };
      delete next[clientId];
      return next;
    });
    setImageErrors((state) => {
      const next = { ...state };
      delete next[clientId];
      return next;
    });
    items.remove(index);
  }

  function selectOption(
    index: number,
    product: ProductConfig,
    groupId: string,
    valueId: string,
    checked: boolean,
  ) {
    const current =
      form.getValues(`items.${index}.selectedOptionValueIds`) ?? [];
    const group = product.optionGroups.find((entry) => entry.id === groupId);
    if (!group) return;
    const groupValueIds = new Set(group.values.map((option) => option.id));
    const withoutGroup = current.filter((id) => !groupValueIds.has(id));
    const withinGroup = current.filter((id) => groupValueIds.has(id));
    const next =
      group.selectionType === "single"
        ? [...withoutGroup, valueId]
        : checked
          ? [...withoutGroup, ...new Set([...withinGroup, valueId])]
          : [...withoutGroup, ...withinGroup.filter((id) => id !== valueId)];
    form.setValue(`items.${index}.selectedOptionValueIds`, next, {
      shouldDirty: true,
      shouldValidate: true,
    });
  }

  function clearOptionGroup(
    index: number,
    product: ProductConfig,
    groupId: string,
  ) {
    const current =
      form.getValues(`items.${index}.selectedOptionValueIds`) ?? [];
    const group = product.optionGroups.find((entry) => entry.id === groupId);
    if (!group) return;
    const groupValueIds = new Set(group.values.map((option) => option.id));
    form.setValue(
      `items.${index}.selectedOptionValueIds`,
      current.filter((id) => !groupValueIds.has(id)),
      { shouldDirty: true, shouldValidate: true },
    );
  }

  async function uploadImages(value: OrderFormInput) {
    let completed = 0;
    const total = Object.values(images).reduce(
      (sum, entries) => sum + entries.length,
      0,
    );
    const uploaded: Record<string, string[]> = {};
    for (const item of value.items) {
      uploaded[item.clientId] = [];
      for (const image of images[item.clientId] ?? []) {
        const previousId = uploadedByLocalId.current[image.localId];
        if (previousId) {
          uploaded[item.clientId].push(previousId);
          completed += 1;
          continue;
        }
        try {
          setUploadLabel(`참고 이미지 업로드 중 ${completed + 1}/${total}`);
          const body = new FormData();
          body.set("clientItemId", item.clientId);
          body.set("width", String(image.width));
          body.set("height", String(image.height));
          body.set("file", image.file);
          const response = await fetch("/api/order-images", {
            method: "POST",
            body,
          });
          const payload = (await response.json()) as {
            id?: string;
            error?: { message: string };
          };
          if (!response.ok || !payload.id)
            throw new Error(
              payload.error?.message ?? "이미지를 업로드하지 못했어요.",
            );
          uploadedByLocalId.current[image.localId] = payload.id;
          uploaded[item.clientId].push(payload.id);
          completed += 1;
        } catch (error) {
          throw new ImageUploadError(
            item.clientId,
            error instanceof Error
              ? error.message
              : "이미지를 업로드하지 못했어요.",
          );
        }
      }
    }
    return uploaded;
  }

  async function submit(value: OrderFormInput) {
    setSubmitting(true);
    setSubmitError("");
    setImageErrors({});
    try {
      const uploaded = await uploadImages(value);
      setUploadLabel("주문을 접수하고 있어요");
      const body = {
        ...value,
        items: value.items.map((item) => ({
          ...item,
          images: uploaded[item.clientId] ?? [],
        })),
      };
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey.current,
        },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        redirectTo?: string;
        error?: { message: string };
      };
      if (!response.ok || !payload.redirectTo)
        throw new Error(payload.error?.message ?? "주문을 접수하지 못했어요.");
      window.location.assign(payload.redirectTo);
    } catch (error) {
      if (error instanceof ImageUploadError)
        setImageErrors((state) => ({
          ...state,
          [error.clientId]: error.message,
        }));
      else
        setSubmitError(
          error instanceof Error ? error.message : "잠시 후 다시 시도해주세요.",
        );
      setSubmitting(false);
      setUploadLabel("");
    }
  }

  return (
    <>
      <Script
        src="https://t1.kakaocdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"
        strategy="afterInteractive"
        onReady={() => setPostcodeError("")}
        onError={() =>
          setPostcodeError(
            "주소 검색을 불러오지 못했어요. 인터넷 연결을 확인한 후 다시 시도해주세요.",
          )
        }
      />
      <div className="timer-bar" aria-live="polite">
        <div>
          <strong>
            <Clock3 size={15} /> 주문 자리 확보 중
          </strong>
          <span>입장 후 30분 안에 제출해주세요.</span>
        </div>
        <b>{remainingLabel(remaining)}</b>
      </div>
      {idleWarning && (
        <div className="idle-warning" role="alertdialog" aria-modal="true">
          <div>
            <Clock3 size={24} />
            <h2>계속 작성하고 계신가요?</h2>
            <p>
              1분 안에 화면을 클릭하거나 입력하지 않으면 주문 자리가 자동으로
              반환됩니다.
            </p>
            <Button
              onClick={() => {
                activityAt.current = Date.now();
                setIdleWarning(false);
              }}
            >
              계속 작성하기
            </Button>
          </div>
        </div>
      )}

      <form
        className="surface-card order-custom-form"
        onSubmit={form.handleSubmit(submit)}
      >
        <div className="bot-field" aria-hidden="true">
          <label>
            웹사이트
            <input
              tabIndex={-1}
              autoComplete="off"
              {...form.register("website")}
            />
          </label>
        </div>
        <FormHeading
          number="01"
          title="주문자 정보"
          description="주문 확인과 제작 안내에 사용됩니다."
        />
        <p className="required-guide">
          <RequiredMark /> 표시된 항목은 필수 입력입니다.
        </p>
        <div className="form-grid">
          <Field
            label="이름"
            error={form.formState.errors.customerName?.message}
            required
          >
            <input
              aria-required="true"
              autoComplete="name"
              placeholder="홍길동"
              {...form.register("customerName")}
            />
          </Field>
          <Field
            label="휴대전화"
            error={form.formState.errors.phone?.message}
            required
          >
            <input
              aria-required="true"
              inputMode="tel"
              autoComplete="tel"
              placeholder="010-1234-5678"
              {...form.register("phone")}
            />
          </Field>
          <Field
            label="이메일"
            error={form.formState.errors.email?.message}
            full
            required
          >
            <input
              type="email"
              aria-required="true"
              autoComplete="email"
              inputMode="email"
              placeholder="order@example.com"
              {...form.register("email")}
            />
            <span className="email-delivery-hint" role="note">
              <MailCheck size={16} aria-hidden="true" />
              <span>
                주문 상태를 확인할 수 있는 주문번호와 주요 안내를 보내드려요.
                오타 없이 실제로 확인 가능한 이메일 주소를 입력해주세요.
              </span>
            </span>
          </Field>
          <Field
            label="입금자명"
            error={form.formState.errors.depositorName?.message}
            full
            required
          >
            <input
              aria-required="true"
              placeholder="실제 입금할 이름"
              {...form.register("depositorName")}
            />
          </Field>
        </div>

        <div className="form-section">
          <FormHeading
            number="02"
            title="상품별 주문 정보"
            description="제작할 상품마다 따로 입력해주세요."
          />
          <div className="custom-production-note">
            <strong>부스부스 커스텀 제작 안내</strong>
            <p>
              스펠링의 대소문자 규칙없이, 가장 잘 어울리는 패치 느낌과 색감을
              고려하여 자유롭게 제작합니다. 별도의 디자인 시안은 제공되지
              않으며, 부스부스만의 감성과 스타일을 믿고 맡겨주시면 가장 잘
              어울리는 조합을 찾아 부스부스만의 디자인으로 예쁘게
              완성해드립니다.
            </p>
          </div>
          <div className="product-picker-list">
            {products.map((product) => {
              const inDraft = watchedItems.filter(
                (item) => item.productId === product.id,
              ).length;
              const unavailable =
                product.remainingStock !== null &&
                inDraft >= product.remainingStock;
              const stockTone =
                product.remainingStock === 0
                  ? "sold-out"
                  : product.remainingStock !== null &&
                      product.remainingStock <= 10
                    ? "low"
                    : "normal";
              return (
                <div className="product-picker-row" key={product.id}>
                  <span className="product-picker-row__icon" aria-hidden="true">
                    {product.type === "shirt" ? (
                      <Shirt size={17} />
                    ) : (
                      <ShoppingBag size={17} />
                    )}
                  </span>
                  <div className="product-picker-row__info">
                    <div>
                      <strong>{product.name}</strong>
                      {product.remainingStock !== null && (
                        <span className={`stock-tag stock-tag--${stockTone}`}>
                          {product.remainingStock === 0
                            ? "품절"
                            : stockTone === "low"
                              ? `${product.remainingStock}개 남음`
                              : `재고 ${product.remainingStock}개`}
                        </span>
                      )}
                    </div>
                    <small>
                      {product.unitPrice.toLocaleString("ko-KR")}원
                      {inDraft > 0 && ` · 현재 ${inDraft}개 담음`}
                    </small>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={unavailable}
                    aria-label={`${product.name} 추가`}
                    onClick={() => items.append(itemDefaults(product))}
                  >
                    <Plus size={14} /> 추가
                  </Button>
                </div>
              );
            })}
          </div>
          <div className="custom-item-list">
            {items.fields.map((field, index) => {
              const current = watchedItems[index] ?? field;
              const product =
                products.find((entry) => entry.id === current.productId) ??
                firstProduct;
              const itemImages = images[current.clientId] ?? [];
              return (
                <article className="custom-item-card" key={field.fieldKey}>
                  <div className="custom-item-card__header">
                    <div>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      {product.type === "shirt" ? (
                        <Shirt size={18} />
                      ) : (
                        <ShoppingBag size={18} />
                      )}
                      <strong>{product.name}</strong>
                    </div>
                    <button
                      type="button"
                      aria-label={`${product.name} 삭제`}
                      disabled={items.fields.length === 1}
                      onClick={() => removeItem(index, current.clientId)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                  <input
                    type="hidden"
                    {...form.register(`items.${index}.clientId`)}
                  />
                  <input
                    type="hidden"
                    {...form.register(`items.${index}.productId`)}
                  />
                  <input
                    type="hidden"
                    {...form.register(`items.${index}.itemType`)}
                  />
                  <input
                    type="hidden"
                    {...form.register(`items.${index}.selectedOptionValueIds`)}
                  />
                  {product.description && (
                    <p className="custom-item-card__description">
                      {product.description}
                    </p>
                  )}
                  <div className="form-grid compact-grid">
                    {product.customization.initialEnabled && (
                      <Field
                        label="이니셜"
                        error={
                          form.formState.errors.items?.[index]?.initialText
                            ?.message
                        }
                        full
                        required
                      >
                        <input
                          aria-required="true"
                          maxLength={40}
                          autoCapitalize="off"
                          placeholder={`영문 대·소문자, 공백 제외 최대 ${INITIAL_TEXT_LIMIT}자`}
                          onInput={(event) => {
                            event.currentTarget.value = limitInitialTextInput(
                              event.currentTarget.value,
                            );
                          }}
                          {...form.register(`items.${index}.initialText`)}
                        />
                        <span className="field__hint">
                          공백 제외{" "}
                          {
                            (current.initialText ?? "").replaceAll(" ", "")
                              .length
                          }
                          /{INITIAL_TEXT_LIMIT}자
                        </span>
                      </Field>
                    )}
                    {product.optionGroups
                      .filter((group) => group.active)
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((group) => {
                        const selected = new Set(
                          current.selectedOptionValueIds ?? [],
                        );
                        const activeValues = group.values
                          .filter((option) => option.active)
                          .sort((a, b) => a.sortOrder - b.sortOrder);
                        const selectedCount = activeValues.filter((option) =>
                          selected.has(option.id),
                        ).length;
                        const minimum = group.required
                          ? Math.max(1, group.minSelections)
                          : group.minSelections;
                        return (
                          <fieldset
                            className="field option-choice-field"
                            key={group.id}
                          >
                            <legend className="field__label">
                              {group.name}
                              {group.required && <RequiredMark />}
                            </legend>
                            {group.selectionType === "single" ? (
                              <select
                                aria-label={group.name}
                                value={
                                  activeValues.find((option) =>
                                    selected.has(option.id),
                                  )?.id ?? ""
                                }
                                onChange={(event) =>
                                  event.target.value
                                    ? selectOption(
                                        index,
                                        product,
                                        group.id,
                                        event.target.value,
                                        true,
                                      )
                                    : clearOptionGroup(index, product, group.id)
                                }
                              >
                                {minimum === 0 ? (
                                  <option value="">선택 안 함</option>
                                ) : (
                                  <option value="" disabled>
                                    선택해주세요
                                  </option>
                                )}
                                {activeValues.map((option) => (
                                  <option value={option.id} key={option.id}>
                                    {option.label}
                                    {option.priceDelta > 0
                                      ? ` (+${option.priceDelta.toLocaleString("ko-KR")}원)`
                                      : ""}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <div className="option-choice-list">
                                {activeValues.map((option) => (
                                  <label key={option.id}>
                                    <input
                                      type="checkbox"
                                      name={`item-${index}-group-${group.id}`}
                                      checked={selected.has(option.id)}
                                      disabled={
                                        !selected.has(option.id) &&
                                        selectedCount >= group.maxSelections
                                      }
                                      onChange={(event) =>
                                        selectOption(
                                          index,
                                          product,
                                          group.id,
                                          option.id,
                                          event.target.checked,
                                        )
                                      }
                                    />
                                    <span>
                                      <strong>{option.label}</strong>
                                      {option.priceDelta > 0 && (
                                        <small>
                                          +
                                          {option.priceDelta.toLocaleString(
                                            "ko-KR",
                                          )}
                                          원
                                        </small>
                                      )}
                                    </span>
                                  </label>
                                ))}
                              </div>
                            )}
                          </fieldset>
                        );
                      })}
                  </div>
                  {product.customization.stickerEnabled && (
                    <div className="form-grid compact-grid sticker-selection-fields">
                      <Field label="랜덤 이니셜 스티커" full>
                        <select
                          value={
                            current.stickerSelected ? "selected" : "unselected"
                          }
                          onChange={(event) => {
                            const selected = event.target.value === "selected";
                            form.setValue(
                              `items.${index}.stickerSelected`,
                              selected,
                              { shouldDirty: true },
                            );
                            if (!selected)
                              form.setValue(
                                `items.${index}.stickerCategories`,
                                "",
                                { shouldDirty: true },
                              );
                          }}
                        >
                          <option value="unselected">미선택</option>
                          <option value="selected">선택</option>
                        </select>
                        <span className="field__hint">
                          말씀해주신 카테고리를 바탕으로 이니셜과 가장 잘
                          어울리는 디자인을 랜덤 구성하여 제작합니다.
                        </span>
                      </Field>
                      {current.stickerSelected && (
                        <Field
                          label="원하는 스티커 카테고리"
                          error={
                            form.formState.errors.items?.[index]
                              ?.stickerCategories?.message
                          }
                          full
                        >
                          <input
                            placeholder="자동차, 공룡, 무지개처럼 3~5개 권장"
                            {...form.register(
                              `items.${index}.stickerCategories`,
                            )}
                          />
                        </Field>
                      )}
                    </div>
                  )}
                  {(product.customization.referenceImagesEnabled ||
                    product.customization.extraRequestEnabled) && (
                    <section className="preference-details preference-details--static">
                      <div className="preference-details__heading">
                        <strong>디자인 참고사항</strong>
                        <span>선택</span>
                      </div>
                      {product.customization.referenceImagesEnabled && (
                        <div
                          className={`image-picker ${imageErrors[current.clientId] ? "image-picker--error" : ""}`}
                        >
                          <div>
                            <strong>
                              <Camera size={15} /> 디자인 참고 이미지
                            </strong>
                            <span>
                              부스부스 인스타그램에 올라온 디자인 중 마음에 드는
                              스타일이 있다면 사진을 첨부해주세요. 디자인할 때
                              참고하여 반영해드립니다. 상품당 최대 3장까지
                              첨부할 수 있어요.
                            </span>
                          </div>
                          <div className="image-grid">
                            {itemImages.map((image) => (
                              <figure key={image.localId}>
                                <img
                                  src={image.preview}
                                  alt="업로드할 디자인 참고 이미지 미리보기"
                                />
                                <button
                                  type="button"
                                  aria-label="디자인 참고 이미지 삭제"
                                  onClick={() =>
                                    removeImage(current.clientId, image.localId)
                                  }
                                >
                                  <Trash2 size={14} />
                                </button>
                              </figure>
                            ))}
                            {itemImages.length < 3 && totalImages < 20 && (
                              <label className="image-add">
                                <ImagePlus size={20} />
                                <span>사진 추가</span>
                                <input
                                  type="file"
                                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                                  multiple
                                  onChange={(event) => {
                                    void addImages(
                                      current.clientId,
                                      event.target.files,
                                    );
                                    event.target.value = "";
                                  }}
                                />
                              </label>
                            )}
                          </div>
                          {imageErrors[current.clientId] && (
                            <p className="image-picker__error" role="alert">
                              {imageErrors[current.clientId]}
                            </p>
                          )}
                        </div>
                      )}
                      {product.customization.extraRequestEnabled && (
                        <Field label="기타 요청사항" full>
                          <textarea
                            placeholder="추가로 참고할 내용을 입력해주세요."
                            {...form.register(`items.${index}.extraRequest`)}
                          />
                        </Field>
                      )}
                    </section>
                  )}
                  <div className="item-price">
                    <span>상품 금액</span>
                    <strong>
                      {itemPrice(
                        product,
                        current.selectedOptionValueIds,
                      ).toLocaleString("ko-KR")}
                      원
                    </strong>
                  </div>
                </article>
              );
            })}
          </div>
          {form.formState.errors.items?.message && (
            <p className="field__error">
              {form.formState.errors.items.message}
            </p>
          )}
          <p className="field__hint">
            주문 수량 제한은 없습니다. 참고 이미지는 주문 전체에서 최대 20장까지
            첨부할 수 있어요. ({totalImages}/20)
          </p>
        </div>

        <div className="form-section">
          <FormHeading
            number="03"
            title="수령 방법"
            description="택배 배송 또는 직접 픽업을 선택해주세요."
          />
          <div className="choice-cards">
            <label>
              <input
                type="radio"
                value="shipping"
                {...form.register("fulfillmentType")}
              />
              <span>
                <Truck size={19} />
                <strong>택배 배송</strong>
                <small>
                  {freeShippingThreshold.toLocaleString("ko-KR")}원 미만 배송비{" "}
                  {shippingFee.toLocaleString("ko-KR")}원
                  <br />
                  제주·도서산간은 {remoteAreaSurcharge.toLocaleString("ko-KR")}
                  원 추가
                </small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                value="pickup"
                {...form.register("fulfillmentType")}
              />
              <span>
                <ShoppingBag size={19} />
                <strong>매장 픽업</strong>
                <small>제작 완료 후 개별 연락드립니다.</small>
              </span>
            </label>
          </div>
          {fulfillmentType === "shipping" ? (
            <div className="delivery-fields">
              <input type="hidden" {...form.register("postalCode")} />
              <input type="hidden" {...form.register("address")} />
              <div className="field delivery-address-field">
                <span className="field__label">
                  배송지 <RequiredMark />
                </span>
                {postalCode && baseAddress ? (
                  <div className="address-result-card">
                    <span
                      className="address-result-card__icon"
                      aria-hidden="true"
                    >
                      <MapPin size={18} />
                    </span>
                    <div className="address-result-card__body">
                      <small>우편번호 {postalCode}</small>
                      <strong>{baseAddress}</strong>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      className="address-change-button"
                      onClick={openPostcode}
                    >
                      주소 변경
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="secondary"
                    className="address-search-trigger"
                    onClick={openPostcode}
                  >
                    <Search size={17} /> 주소 찾기
                  </Button>
                )}
                {(form.formState.errors.postalCode?.message ||
                  form.formState.errors.address?.message) && (
                  <span className="field__error" role="alert">
                    {form.formState.errors.postalCode?.message ??
                      form.formState.errors.address?.message}
                  </span>
                )}
                {postcodeError && (
                  <span className="field__error" role="alert">
                    {postcodeError}
                  </span>
                )}
              </div>
              {postalCode && baseAddress && (
                <Field
                  label="상세 주소"
                  error={form.formState.errors.addressDetail?.message}
                  required
                >
                  <input
                    aria-required="true"
                    autoComplete="address-line2"
                    placeholder="동·호수 등 상세 주소를 입력해주세요"
                    {...form.register("addressDetail")}
                  />
                </Field>
              )}
              {totals.deliveryZone === "remote" && (
                <div className="notice notice--warning" role="status">
                  <strong>제주·도서산간 추가 배송비가 적용됩니다.</strong>
                  <br />
                  무료배송 기준 충족 여부와 관계없이{" "}
                  {remoteAreaSurcharge.toLocaleString("ko-KR")}원이 추가됩니다.
                </div>
              )}
            </div>
          ) : null}
        </div>

        <div className="form-section">
          <FormHeading
            number="04"
            title="현금영수증"
            description="필요한 경우 발급 정보를 남겨주세요."
          />
          <div className="form-grid">
            <Field label="신청 유형" full>
              <select {...form.register("cashReceiptType")}>
                <option value="none">신청 안 함</option>
                <option value="personal">개인 소득공제용</option>
                <option value="business">사업자 지출증빙용</option>
              </select>
            </Field>
            {cashReceiptType !== "none" && (
              <Field
                label={
                  cashReceiptType === "personal"
                    ? "휴대전화 번호"
                    : "사업자등록번호"
                }
                error={form.formState.errors.cashReceiptIdentifier?.message}
                full
                required
              >
                <input
                  aria-required="true"
                  inputMode="numeric"
                  placeholder={
                    cashReceiptType === "personal"
                      ? "01012345678"
                      : "1234567890"
                  }
                  {...form.register("cashReceiptIdentifier")}
                />
              </Field>
            )}
          </div>
        </div>

        <div className="summary-box order-total-box">
          <div className="summary-line">
            <span>상품 {watchedItems.length}개</span>
            <strong>{totals.subtotal.toLocaleString("ko-KR")}원</strong>
          </div>
          <div className="summary-line">
            <span>기본 배송비</span>
            <strong>
              {totals.baseShippingFee
                ? `${totals.baseShippingFee.toLocaleString("ko-KR")}원`
                : "무료"}
            </strong>
          </div>
          {totals.remoteAreaSurcharge > 0 && (
            <div className="summary-line">
              <span>제주·도서산간 추가 배송비</span>
              <strong>
                +{totals.remoteAreaSurcharge.toLocaleString("ko-KR")}원
              </strong>
            </div>
          )}
          <div className="summary-line summary-line--total">
            <span>총 입금 금액</span>
            <strong>{totals.total.toLocaleString("ko-KR")}원</strong>
          </div>
        </div>

        <label className="checkbox privacy-box">
          <input
            type="checkbox"
            aria-required="true"
            {...form.register("privacyConsent")}
          />
          <span>
            <strong>
              개인정보 수집 및 이용에 동의합니다. <RequiredMark />
            </strong>
            <br />
            주문 확인 이메일, 제작, 배송·픽업과 고객 문의를 위해 이메일 주소,
            연락처, 주소, 현금영수증 정보와 참고 이미지를 수집합니다.
          </span>
        </label>
        {form.formState.errors.privacyConsent?.message && (
          <p className="field__error">
            {form.formState.errors.privacyConsent.message}
          </p>
        )}
        <label className="checkbox privacy-box custom-consent">
          <input
            type="checkbox"
            aria-required="true"
            {...form.register("customOrderConsent")}
          />
          <span>
            <strong>
              커스텀 제작 및 교환·환불 안내에 동의합니다. <RequiredMark />
            </strong>
            <br />
            커스텀 상품은 주문 제작 상품으로, 선입금 확인 후 제작이 진행됩니다.
            별도의 디자인 시안은 제공되지 않으며, 커스텀 상품 특성상 제작이
            시작된 이후에는 교환 및 환불이 어렵습니다. 의류 불량 또는 주문
            내용과 다르게 젝된 상품은 확인 후 긴급 제작 후 교환해드립니다.
          </span>
        </label>
        {form.formState.errors.customOrderConsent?.message && (
          <p className="field__error">
            {form.formState.errors.customOrderConsent.message}
          </p>
        )}
        {submitError && <p className="form-error">{submitError}</p>}
        <div className="form-actions sticky-submit">
          <Button
            type="button"
            variant="ghost"
            onClick={() => void releaseAndLeave("주문서 작성을 종료했어요.")}
          >
            나가기
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting
              ? uploadLabel || "주문 접수 중…"
              : `${totals.total.toLocaleString("ko-KR")}원 주문하기`}
          </Button>
        </div>
      </form>
    </>
  );
}

function FormHeading({
  number,
  title,
  description,
}: {
  number: string;
  title: string;
  description: string;
}) {
  return (
    <div className="form-section__heading">
      <span>{number}</span>
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
    </div>
  );
}

function RequiredMark() {
  return (
    <>
      <span className="required-mark" aria-hidden="true">
        *
      </span>
      <span className="sr-only">필수</span>
    </>
  );
}

function Field({
  label,
  error,
  full = false,
  required = false,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`field ${full ? "field--full" : ""}`}>
      <span className="field__label">
        {label}
        {required && (
          <>
            {" "}
            <RequiredMark />
          </>
        )}
      </span>
      {children}
      {error && <span className="field__error">{error}</span>}
    </div>
  );
}
