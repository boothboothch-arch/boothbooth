"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import {
  Camera,
  Check,
  Copy,
  ExternalLink,
  ImagePlus,
  MapPin,
  MessageCircle,
  PackageCheck,
  Pencil,
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
  isCustomerEditable,
  itemPrice,
  limitInitialTextInput,
  orderStateLabel,
  orderTotals,
  type OrderView,
} from "../domain/order";
import type { CustomerOrderUpdateInput } from "../schemas";

type EditableImage =
  | {
      kind: "existing";
      localId: string;
      id: string;
      preview: string;
      width: number;
      height: number;
    }
  | ({ kind: "new" } & ImageDraft);

class EditImageUploadError extends Error {
  constructor(
    public readonly itemId: string,
    message: string,
  ) {
    super(message);
    this.name = "EditImageUploadError";
  }
}

declare global {
  interface Window {
    daum?: {
      Postcode: new (options: {
        oncomplete: (data: { zonecode: string; address: string }) => void;
      }) => { open: () => void };
    };
  }
}

function receiptLabel(type: OrderView["cashReceiptType"]) {
  return type === "personal"
    ? "개인 소득공제용"
    : type === "business"
      ? "사업자 지출증빙용"
      : "신청 안 함";
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("COPY_FAILED");
}

function orderDraft(order: OrderView): CustomerOrderUpdateInput {
  return {
    fulfillmentType: order.fulfillmentType,
    postalCode: order.address?.postalCode ?? "",
    address: order.address?.address ?? "",
    addressDetail: order.address?.addressDetail ?? "",
    cashReceiptType: order.cashReceiptType,
    cashReceiptIdentifier: order.cashReceiptIdentifier ?? "",
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      itemType: item.itemType,
      selectedOptionValueIds: item.selectedOptions.map(
        (option) => option.valueId,
      ),
      initialText: item.initialText,
      stickerSelected: item.stickerSelected,
      stickerCategories: item.stickerCategories.join(", "),
      extraRequest: item.extraRequest,
      images: item.images.map((image) => image.id),
    })),
  };
}

function editableImages(order: OrderView) {
  return Object.fromEntries(
    order.items.map((item) => [
      item.id,
      item.images.map(
        (image): EditableImage => ({
          kind: "existing",
          localId: `existing-${image.id}`,
          id: image.id,
          preview: image.url,
          width: image.width,
          height: image.height,
        }),
      ),
    ]),
  );
}

export function OrderDetail({
  initialOrder,
  complete = false,
}: {
  initialOrder: OrderView;
  complete?: boolean;
}) {
  const [order, setOrder] = useState(initialOrder);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preparingImages, setPreparingImages] = useState(false);
  const [error, setError] = useState("");
  const [uploadLabel, setUploadLabel] = useState("");
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [postcodeError, setPostcodeError] = useState("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  const [orderCopyState, setOrderCopyState] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const [trackingCopyState, setTrackingCopyState] = useState<
    "idle" | "copied" | "failed"
  >("idle");
  const detailAddressRef = useRef<HTMLInputElement>(null);
  const orderEditorRef = useRef<HTMLElement>(null);
  const [draft, setDraft] = useState<CustomerOrderUpdateInput>(() =>
    orderDraft(initialOrder),
  );
  const [editImages, setEditImages] = useState<Record<string, EditableImage[]>>(
    () => editableImages(initialOrder),
  );
  const editImagesRef = useRef(editImages);
  const uploadedByLocalId = useRef<Record<string, string>>({});
  const currentStatusIndex = [
    "payment_pending",
    "payment_confirmed",
    "preparing",
    "completed",
  ].indexOf(order.orderState);
  const statusDescription = {
    payment_pending: "입금 확인을 기다리고 있어요.",
    payment_confirmed: "입금이 확인되었습니다.",
    preparing: "상품을 제작하고 있어요.",
    completed: "상품 출고가 완료되었습니다.",
    cancelled: "주문이 취소되었습니다.",
  }[order.orderState];
  const hasShirt = order.items.some((item) => item.itemType === "shirt");
  const duePassed =
    Date.parse(order.paymentDueAt) < Date.now() &&
    order.paymentState === "pending" &&
    order.orderState !== "cancelled";
  const draftTotals = orderTotals(
    order.availableProducts,
    draft.items,
    draft.fulfillmentType,
    {
      shippingFee: order.deliveryConfig.shippingFee,
      freeShippingThreshold: order.deliveryConfig.freeShippingThreshold,
      remoteAreaSurcharge: order.deliveryConfig.remoteAreaSurcharge,
      postalCode: draft.postalCode,
      remotePostalRanges: order.deliveryConfig.remotePostalRanges,
    },
  );
  const totalEditImages = Object.values(editImages).reduce(
    (sum, images) => sum + images.length,
    0,
  );

  useEffect(() => {
    editImagesRef.current = editImages;
  }, [editImages]);
  useEffect(
    () => () => {
      Object.values(editImagesRef.current)
        .flat()
        .filter((image) => image.kind === "new")
        .forEach((image) => URL.revokeObjectURL(image.preview));
      Object.values(uploadedByLocalId.current).forEach((id) => {
        void fetch(`/api/orders/${initialOrder.orderNumber}/images`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
          keepalive: true,
        });
      });
    },
    [],
  );

  async function copyAccount() {
    try {
      await copyText(order.bank.account);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2000);
    } catch {
      setCopyState("failed");
    }
  }
  async function copyOrderNumber() {
    try {
      await copyText(order.orderNumber);
      setOrderCopyState("copied");
      window.setTimeout(() => setOrderCopyState("idle"), 2000);
    } catch {
      setOrderCopyState("failed");
    }
  }
  async function copyTrackingNumber() {
    const trackingNumber = order.shipment?.trackingNumber;
    if (!trackingNumber) return;
    try {
      await copyText(trackingNumber);
      setTrackingCopyState("copied");
      window.setTimeout(() => setTrackingCopyState("idle"), 2000);
    } catch {
      setTrackingCopyState("failed");
    }
  }
  function openPostcode() {
    if (!window.daum?.Postcode) {
      setPostcodeError(
        "주소 검색을 불러오지 못했어요. 인터넷 연결을 확인한 후 다시 시도해주세요.",
      );
      return;
    }
    setPostcodeError("");
    new window.daum.Postcode({
      oncomplete: (data) => {
        setDraft((current) => ({
          ...current,
          postalCode: data.zonecode,
          address: data.address,
          addressDetail: "",
        }));
        window.requestAnimationFrame(() => detailAddressRef.current?.focus());
      },
    }).open();
  }
  function deleteStagedImage(id: string) {
    void fetch(`/api/orders/${order.orderNumber}/images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
  }
  function releaseNewImage(image: EditableImage, deleteUpload = true) {
    if (image.kind !== "new") return;
    URL.revokeObjectURL(image.preview);
    const uploadedId = uploadedByLocalId.current[image.localId];
    if (uploadedId) {
      delete uploadedByLocalId.current[image.localId];
      if (deleteUpload) deleteStagedImage(uploadedId);
    }
  }
  function resetEditor(nextOrder: OrderView, deleteUploads = true) {
    Object.values(editImagesRef.current)
      .flat()
      .forEach((image) => releaseNewImage(image, deleteUploads));
    uploadedByLocalId.current = {};
    const nextImages = editableImages(nextOrder);
    editImagesRef.current = nextImages;
    setEditImages(nextImages);
    setDraft(orderDraft(nextOrder));
    setImageErrors({});
    setUploadLabel("");
    setError("");
  }
  function startEditing() {
    resetEditor(order);
    setEditing(true);
    window.requestAnimationFrame(() =>
      orderEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
    );
  }
  function cancelEditing() {
    resetEditor(order);
    setEditing(false);
  }
  async function changeImages(
    itemId: string,
    selected: FileList | null,
    replaceLocalId?: string,
  ) {
    if (!selected?.length) return;
    setImageErrors((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
    const currentImages = editImages[itemId] ?? [];
    const available = Math.max(
      0,
      Math.min(3 - currentImages.length, 20 - totalEditImages),
    );
    const files = replaceLocalId
      ? Array.from(selected).slice(0, 1)
      : Array.from(selected).slice(0, available);
    if (files.length === 0) return;
    const prepared: EditableImage[] = [];
    setPreparingImages(true);
    try {
      for (const file of files)
        prepared.push({ kind: "new", ...(await prepareImage(file)) });
      if (replaceLocalId) {
        const replaced = currentImages.find(
          (image) => image.localId === replaceLocalId,
        );
        if (replaced) releaseNewImage(replaced);
        setEditImages((current) => ({
          ...current,
          [itemId]: (current[itemId] ?? []).map((image) =>
            image.localId === replaceLocalId ? prepared[0] : image,
          ),
        }));
      } else if (prepared.length > 0) {
        setEditImages((current) => ({
          ...current,
          [itemId]: [...(current[itemId] ?? []), ...prepared],
        }));
      }
    } catch (cause) {
      prepared.forEach((image) => releaseNewImage(image));
      setImageErrors((current) => ({
        ...current,
        [itemId]:
          cause instanceof Error
            ? cause.message
            : "이미지를 처리하지 못했어요.",
      }));
    } finally {
      setPreparingImages(false);
    }
  }
  function removeEditImage(itemId: string, localId: string) {
    const target = editImages[itemId]?.find(
      (image) => image.localId === localId,
    );
    if (target) releaseNewImage(target);
    setEditImages((current) => ({
      ...current,
      [itemId]: (current[itemId] ?? []).filter(
        (image) => image.localId !== localId,
      ),
    }));
    setImageErrors((current) => {
      const next = { ...current };
      delete next[itemId];
      return next;
    });
  }
  function updateItem(
    index: number,
    patch: Partial<CustomerOrderUpdateInput["items"][number]>,
  ) {
    setDraft((current) => ({
      ...current,
      items: current.items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }));
  }
  function selectDraftOption(
    index: number,
    product: OrderView["availableProducts"][number],
    groupId: string,
    valueId: string,
    checked: boolean,
  ) {
    const item = draft.items[index];
    const group = product.optionGroups.find((entry) => entry.id === groupId);
    if (!item || !group) return;
    const groupIds = new Set(group.values.map((option) => option.id));
    const outside = item.selectedOptionValueIds.filter(
      (id) => !groupIds.has(id),
    );
    const inside = item.selectedOptionValueIds.filter((id) => groupIds.has(id));
    updateItem(index, {
      selectedOptionValueIds:
        group.selectionType === "single"
          ? [...outside, valueId]
          : checked
            ? [...outside, ...new Set([...inside, valueId])]
            : [...outside, ...inside.filter((id) => id !== valueId)],
    });
  }
  function clearDraftOptionGroup(
    index: number,
    product: OrderView["availableProducts"][number],
    groupId: string,
  ) {
    const item = draft.items[index];
    const group = product.optionGroups.find((entry) => entry.id === groupId);
    if (!item || !group) return;
    const groupIds = new Set(group.values.map((option) => option.id));
    updateItem(index, {
      selectedOptionValueIds: item.selectedOptionValueIds.filter(
        (id) => !groupIds.has(id),
      ),
    });
  }
  async function uploadEditImages() {
    const total = Object.values(editImages)
      .flat()
      .filter((image) => image.kind === "new").length;
    let completed = 0;
    const uploaded: Record<string, string[]> = {};
    for (const item of draft.items) {
      uploaded[item.id] = [];
      for (const image of editImages[item.id] ?? []) {
        if (image.kind === "existing") {
          uploaded[item.id].push(image.id);
          continue;
        }
        const previousId = uploadedByLocalId.current[image.localId];
        if (previousId) {
          uploaded[item.id].push(previousId);
          completed += 1;
          continue;
        }
        try {
          setUploadLabel(`참고 이미지 업로드 중 ${completed + 1}/${total}`);
          const body = new FormData();
          body.set("orderItemId", item.id);
          body.set("width", String(image.width));
          body.set("height", String(image.height));
          body.set("file", image.file);
          const response = await fetch(
            `/api/orders/${order.orderNumber}/images`,
            { method: "POST", body },
          );
          const payload = (await response.json()) as {
            id?: string;
            error?: { message: string };
          };
          if (!response.ok || !payload.id)
            throw new Error(
              payload.error?.message ?? "이미지를 업로드하지 못했어요.",
            );
          uploadedByLocalId.current[image.localId] = payload.id;
          uploaded[item.id].push(payload.id);
          completed += 1;
        } catch (cause) {
          throw new EditImageUploadError(
            item.id,
            cause instanceof Error
              ? cause.message
              : "이미지를 업로드하지 못했어요.",
          );
        }
      }
    }
    return uploaded;
  }
  async function save() {
    setSaving(true);
    setError("");
    setImageErrors({});
    try {
      const uploaded = await uploadEditImages();
      setUploadLabel("변경 내용을 저장하고 있어요");
      const body = {
        ...draft,
        items: draft.items.map((item) => ({
          ...item,
          images: uploaded[item.id] ?? [],
        })),
      };
      const response = await fetch(`/api/orders/${order.orderNumber}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json()) as {
        totalAmount?: number;
        subtotalAmount?: number;
        baseShippingFee?: number;
        remoteAreaSurcharge?: number;
        shippingFee?: number;
        deliveryZone?: OrderView["deliveryZone"];
        error?: { message: string };
      };
      if (!response.ok)
        throw new Error(payload.error?.message ?? "수정하지 못했어요.");
      const refreshed = await fetch(`/api/orders/${order.orderNumber}`, {
        cache: "no-store",
      });
      if (!refreshed.ok) {
        window.location.reload();
        return;
      }
      const nextOrder = (await refreshed.json()) as OrderView;
      resetEditor(nextOrder, false);
      setOrder(nextOrder);
      setEditing(false);
    } catch (cause) {
      if (cause instanceof EditImageUploadError)
        setImageErrors((current) => ({
          ...current,
          [cause.itemId]: cause.message,
        }));
      else
        setError(cause instanceof Error ? cause.message : "수정하지 못했어요.");
    } finally {
      setSaving(false);
      setUploadLabel("");
    }
  }

  return (
    <>
      <Script
        src="//t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js"
        strategy="afterInteractive"
      />
      {complete && (
        <>
          <div className="complete-mark">
            <span>
              <Check size={25} />
            </span>
            <h1>주문이 접수됐어요</h1>
            <p>
              <strong>주문번호를 꼭 개인 보관해주세요.</strong>
              <br />
              주문 조회 시 주문번호와 휴대전화 번호 뒷자리가 필요합니다.
            </p>
          </div>
          <aside className="complete-kakao-callout" aria-labelledby="complete-kakao-title">
            <span className="complete-kakao-callout__icon" aria-hidden="true">
              <MessageCircle size={24} />
            </span>
            <div>
              <span>개인 커스텀을 추가하셨나요?</span>
              <strong id="complete-kakao-title">
                개인 커스텀 추가 시 카카오톡 채널로 커스텀 내용을 꼭 전달 부탁드립니다.
              </strong>
            </div>
            <a href={order.kakaoChannelUrl} target="_blank" rel="noreferrer">
              부스부스 카카오톡 채널 바로가기
              <ExternalLink size={15} />
            </a>
          </aside>
        </>
      )}
      <div className="order-detail-grid">
        <section className="surface-card order-info-card">
          {isCustomerEditable(order.orderState) && !editing && (
            <div className="order-edit-entry">
              <p>
                <strong>입금 완료</strong>로 변경되면 주문 수정 불가
              </p>
              <Button type="button" variant="secondary" onClick={startEditing}>
                <Pencil size={13} /> 주문 수정
              </Button>
            </div>
          )}
          <div className="order-info-card__header">
            <div>
              <span>
                {order.saleKind === "test" ? "테스트 · " : ""}
                {order.roundNumber ? `${order.roundNumber}차 · ` : ""}주문번호
              </span>
              <div className="order-number-copy-row">
                <strong>{order.orderNumber}</strong>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void copyOrderNumber()}
                >
                  {orderCopyState === "copied" ? (
                    <Check size={14} />
                  ) : (
                    <Copy size={14} />
                  )}{" "}
                  {orderCopyState === "copied" ? "복사했어요" : "복사"}
                </Button>
              </div>
            </div>
            <div
              className={`current-order-status current-order-status--${order.orderState}`}
            >
              <span>현재 주문 상태</span>
              <strong>{orderStateLabel[order.orderState]}</strong>
              <small>
                {order.saleKind === "test"
                  ? `테스트 주문 · ${statusDescription}`
                  : statusDescription}
              </small>
            </div>
          </div>
          <div
            className={`order-number-keep-note ${orderCopyState === "failed" ? "order-number-keep-note--error" : ""}`}
            role="note"
            aria-live="polite"
          >
            <strong>주문번호를 꼭 개인 보관해주세요.</strong>
            <span>
              {orderCopyState === "failed"
                ? "복사하지 못했어요. 주문번호를 길게 눌러 복사해주세요."
                : "주문 조회 시 주문번호와 휴대전화 번호 뒷자리가 필요합니다."}
            </span>
          </div>
          <div className="status-track">
            {[
              ["입금 대기", PackageCheck],
              ["입금 완료", Check],
              ["제작 중", Shirt],
              ["출고 완료", Truck],
            ].map(([label, Icon], index) => (
              <div
                className={`${index <= currentStatusIndex ? "active" : ""} ${index === currentStatusIndex ? "current" : ""}`.trim()}
                key={String(label)}
              >
                <span>
                  <Icon size={17} />
                </span>
                <small>{String(label)}</small>
              </div>
            ))}
          </div>
          {order.fulfillmentType === "shipping" &&
            (order.orderState === "completed" ||
              order.shipment?.trackingNumber) && (
              <div className="order-shipment-summary">
                <div className="card-title">
                  <h2>배송 정보</h2>
                  <Truck size={17} />
                </div>
                <dl className="info-list">
                  <div>
                    <dt>택배사</dt>
                    <dd>{order.shipment?.carrierName ?? "-"}</dd>
                  </div>
                  <div>
                    <dt>운송장 번호</dt>
                    <dd className="tracking-number-copy-row">
                      <span>
                        {order.shipment?.trackingNumber ??
                          "등록된 운송장 번호가 없습니다."}
                      </span>
                      {order.shipment?.trackingNumber && (
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => void copyTrackingNumber()}
                        >
                          {trackingCopyState === "copied" ? (
                            <Check size={13} />
                          ) : (
                            <Copy size={13} />
                          )}
                          {trackingCopyState === "copied"
                            ? "복사했어요"
                            : trackingCopyState === "failed"
                              ? "복사 실패"
                              : "복사"}
                        </Button>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>출고일</dt>
                    <dd>
                      {order.shipment?.shippedAt
                        ? new Date(
                            order.shipment.shippedAt,
                          ).toLocaleDateString("ko-KR", {
                            timeZone: "Asia/Seoul",
                          })
                        : "-"}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          {order.orderState === "preparing" && (
            <div className="notice notice--warning">
              <strong>제작이 시작되어 주문서를 수정할 수 없습니다.</strong>
              <br />
              추가 변경이 필요하면 카카오톡 채널로 문의해주세요.
            </div>
          )}
          <dl className="info-list">
            <div>
              <dt>판매 차수</dt>
              <dd>{order.saleTitle}</dd>
            </div>
            <div>
              <dt>주문 상태</dt>
              <dd>
                {orderStateLabel[order.orderState]}
                {order.paymentReviewReason
                  ? ` · ${order.paymentReviewReason}`
                  : ""}
              </dd>
            </div>
            {duePassed && (
              <div>
                <dt>입금 안내</dt>
                <dd className="text-danger">
                  1시간 입금 안내 시간이 지났습니다. 주문은 자동 취소되지
                  않습니다.
                </dd>
              </div>
            )}
            {order.cancellationReason && (
              <div>
                <dt>취소 사유</dt>
                <dd>{order.cancellationReason}</dd>
              </div>
            )}
            <div>
              <dt>주문자</dt>
              <dd>
                {order.customerName} · {order.phone}
              </dd>
            </div>
            <div>
              <dt>이메일</dt>
              <dd>{order.email}</dd>
            </div>
            <div>
              <dt>입금자명</dt>
              <dd>{order.depositorName}</dd>
            </div>
            <div>
              <dt>현금영수증</dt>
              <dd>
                {receiptLabel(order.cashReceiptType)}
                {order.cashReceiptIdentifier
                  ? ` · ${order.cashReceiptIdentifier}`
                  : ""}
              </dd>
            </div>
          </dl>
        </section>

        {order.orderState === "payment_pending" && (
          <aside className="bank-card">
            <span>입금 계좌</span>
            <h2>
              {order.bank.bankName}
              <br />
              {order.bank.account}
            </h2>
            <p>
              예금주 {order.bank.holder}
              <br />
              주문자명과 같은 이름으로 입금해주세요.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void copyAccount()}
            >
              {copyState === "copied" ? (
                <Check size={15} />
              ) : (
                <Copy size={15} />
              )}{" "}
              {copyState === "copied" ? "복사했어요" : "계좌번호 복사"}
            </Button>
            <p
              className={`bank-card__copy-status ${copyState === "failed" ? "bank-card__copy-status--error" : ""}`}
              aria-live="polite"
            >
              {copyState === "failed"
                ? "복사하지 못했어요. 계좌번호를 길게 눌러 복사해주세요."
                : copyState === "copied"
                  ? "계좌번호가 클립보드에 복사되었습니다."
                  : ""}
            </p>
            <div>
              입금 안내 시간{" "}
              <strong>
                {new Date(order.paymentDueAt).toLocaleString("ko-KR")}
              </strong>
              <small>입금 시간 내 미입금 시 자동 취소가 됩니다.</small>
            </div>
          </aside>
        )}

        <section className="surface-card order-products">
          <div className="card-title">
            <h2>주문 상품</h2>
            <span>총 {order.totalQuantity}개</span>
          </div>
          {order.items.map((item) => (
            <article className="ordered-custom-item" key={item.id}>
              <div className="ordered-custom-item__title">
                <span>
                  {item.itemType === "shirt" ? (
                    <Shirt size={18} />
                  ) : (
                    <ShoppingBag size={18} />
                  )}
                </span>
                <div>
                  <strong>
                    {item.productName}
                    {item.initialText ? ` · ${item.initialText}` : ""}
                  </strong>
                  <small>
                    {item.selectedOptions
                      .map((option) => option.valueLabel)
                      .join(" · ") || "기본 옵션"}
                    {item.optionSurcharge
                      ? ` · 추가금 ${item.optionSurcharge.toLocaleString("ko-KR")}원`
                      : ""}
                  </small>
                </div>
                <b>{item.lineAmount.toLocaleString("ko-KR")}원</b>
              </div>
              {item.stickerSelected && (
                <p>
                  <strong>스티커</strong>{" "}
                  {item.stickerCategories.join(", ") || "랜덤 구성"}
                </p>
              )}
              {item.extraRequest && (
                <div className="order-preferences">
                  <span>기타 요청 · {item.extraRequest}</span>
                </div>
              )}
              {item.images.length > 0 && (
                <div className="order-image-strip">
                  {item.images.map(
                    (image) =>
                      image.url && (
                        <a
                          href={image.url}
                          target="_blank"
                          rel="noreferrer"
                          key={image.id}
                        >
                          <img
                            src={image.url}
                            alt={`${item.productName} 디자인 참고 이미지`}
                          />
                        </a>
                      ),
                  )}
                </div>
              )}
            </article>
          ))}
          <div className="summary-box">
            <div className="summary-line">
              <span>상품 합계</span>
              <strong>{order.subtotalAmount.toLocaleString("ko-KR")}원</strong>
            </div>
            <div className="summary-line">
              <span>기본 배송비</span>
              <strong>
                {order.baseShippingFee
                  ? `${order.baseShippingFee.toLocaleString("ko-KR")}원`
                  : "무료"}
              </strong>
            </div>
            {order.remoteAreaSurcharge > 0 && (
              <div className="summary-line">
                <span>제주·도서산간 추가 배송비</span>
                <strong>
                  +{order.remoteAreaSurcharge.toLocaleString("ko-KR")}원
                </strong>
              </div>
            )}
            <div className="summary-line summary-line--total">
              <span>총 입금 금액</span>
              <strong>{order.totalAmount.toLocaleString("ko-KR")}원</strong>
            </div>
          </div>
        </section>

        {hasShirt && (
          <section className="surface-card order-care">
            <span>
              <Shirt size={19} />
            </span>
            <div>
              <h2>상품 관리 안내</h2>
              <p>
                선명한 프린팅을 오래 유지하시려면 찬물 세탁 후 자연건조를
                권장드립니다.
              </p>
            </div>
          </section>
        )}

        <section className="surface-card order-address" ref={orderEditorRef}>
          <div className="card-title">
            <h2>
              {order.fulfillmentType === "shipping" ? "배송지" : "픽업 정보"}
            </h2>
          </div>
          {!editing &&
            (order.fulfillmentType === "shipping" && order.address ? (
              <address>
                ({order.address.postalCode}) {order.address.address}
                <br />
                {order.address.addressDetail}
              </address>
            ) : order.pickup ? (
              <address>
                <strong>{order.pickup.name}</strong>
                <br />
                {order.pickup.address && (
                  <>
                    {order.pickup.address}
                    <br />
                  </>
                )}
                {order.pickup.notice}
              </address>
            ) : (
              <p>픽업 정보를 확인해주세요.</p>
            ))}
          {editing && (
            <div className="customer-order-editor">
              <div className="choice-cards">
                <label>
                  <input
                    type="radio"
                    checked={draft.fulfillmentType === "shipping"}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        fulfillmentType: "shipping",
                      }))
                    }
                  />
                  <span>
                    <Truck size={18} />
                    <strong>택배 배송</strong>
                  </span>
                </label>
                <label>
                  <input
                    type="radio"
                    checked={draft.fulfillmentType === "pickup"}
                    onChange={() =>
                      setDraft((current) => ({
                        ...current,
                        fulfillmentType: "pickup",
                      }))
                    }
                  />
                  <span>
                    <ShoppingBag size={18} />
                    <strong>매장 픽업</strong>
                  </span>
                </label>
              </div>
              {draft.fulfillmentType === "shipping" ? (
                <div className="delivery-fields">
                  <div className="field delivery-address-field">
                    <span className="field__label">배송지</span>
                    {draft.postalCode && draft.address ? (
                      <div className="address-result-card">
                        <span
                          className="address-result-card__icon"
                          aria-hidden="true"
                        >
                          <MapPin size={18} />
                        </span>
                        <div className="address-result-card__body">
                          <small>우편번호 {draft.postalCode}</small>
                          <strong>{draft.address}</strong>
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
                    {postcodeError && (
                      <span className="field__error" role="alert">
                        {postcodeError}
                      </span>
                    )}
                  </div>
                  {draft.postalCode && draft.address && (
                    <Field label="상세 주소">
                      <input
                        ref={detailAddressRef}
                        autoComplete="address-line2"
                        value={draft.addressDetail}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            addressDetail: event.target.value,
                          }))
                        }
                        placeholder="동·호수 등 상세 주소를 입력해주세요"
                      />
                    </Field>
                  )}
                  {draftTotals.deliveryZone === "remote" && (
                    <div className="notice notice--warning">
                      <strong>
                        제주·도서산간 추가 배송비{" "}
                        {draftTotals.remoteAreaSurcharge.toLocaleString(
                          "ko-KR",
                        )}
                        원이 적용됩니다.
                      </strong>
                    </div>
                  )}
                </div>
              ) : null}
              <h3>상품 정보</h3>
              {draft.items.map((item, index) => {
                const product = order.availableProducts.find(
                  (entry) => entry.id === item.productId,
                );
                if (!product) return null;
                const selected = new Set(item.selectedOptionValueIds);
                const itemImages = editImages[item.id] ?? [];
                return (
                  <div className="editor-item" key={item.id}>
                    <strong>
                      {index + 1}. {product.name}
                    </strong>
                    <div className="form-grid">
                      {product.optionGroups
                        .filter((group) => group.active)
                        .map((group) => {
                          const activeValues = group.values.filter(
                            (option) => option.active,
                          );
                          const selectedCount = activeValues.filter((option) =>
                            selected.has(option.id),
                          ).length;
                          const minimum = group.required
                            ? Math.max(1, group.minSelections)
                            : group.minSelections;
                          return (
                            <Field label={group.name} full key={group.id}>
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
                                      ? selectDraftOption(
                                          index,
                                          product,
                                          group.id,
                                          event.target.value,
                                          true,
                                        )
                                      : clearDraftOptionGroup(
                                          index,
                                          product,
                                          group.id,
                                        )
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
                                        name={`edit-${index}-${group.id}`}
                                        checked={selected.has(option.id)}
                                        disabled={
                                          !selected.has(option.id) &&
                                          selectedCount >= group.maxSelections
                                        }
                                        onChange={(event) =>
                                          selectDraftOption(
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
                            </Field>
                          );
                        })}
                      {product.customization.initialEnabled && (
                        <Field label="이니셜" full>
                          <input
                            maxLength={40}
                            placeholder={`영문 대·소문자, 공백 제외 최대 ${INITIAL_TEXT_LIMIT}자`}
                            value={item.initialText}
                            onChange={(event) =>
                              updateItem(index, {
                                initialText: limitInitialTextInput(
                                  event.target.value,
                                ),
                              })
                            }
                          />
                          <span className="field__hint">
                            공백 제외 {item.initialText.replaceAll(" ", "").length}/{INITIAL_TEXT_LIMIT}자
                          </span>
                        </Field>
                      )}
                      {product.customization.stickerEnabled && (
                        <>
                          <Field label="랜덤 이니셜 스티커" full>
                            <select
                              value={
                                item.stickerSelected ? "selected" : "unselected"
                              }
                              onChange={(event) =>
                                updateItem(index, {
                                  stickerSelected:
                                    event.target.value === "selected",
                                  ...(event.target.value === "unselected"
                                    ? { stickerCategories: "" }
                                    : {}),
                                })
                              }
                            >
                              <option value="unselected">미선택</option>
                              <option value="selected">선택</option>
                            </select>
                          </Field>
                          {item.stickerSelected && (
                            <Field label="원하는 스티커 카테고리" full>
                              <input
                                value={item.stickerCategories}
                                onChange={(event) =>
                                  updateItem(index, {
                                    stickerCategories: event.target.value,
                                  })
                                }
                                placeholder="자동차, 공룡, 무지개처럼 3~5개 권장"
                              />
                            </Field>
                          )}
                        </>
                      )}
                      {product.customization.extraRequestEnabled && (
                        <Field label="기타 요청" full>
                          <textarea
                            value={item.extraRequest}
                            onChange={(event) =>
                              updateItem(index, {
                                extraRequest: event.target.value,
                              })
                            }
                          />
                        </Field>
                      )}
                      {(product.customization.referenceImagesEnabled ||
                        itemImages.length > 0) && (
                        <div
                          className={`image-picker edit-image-picker ${imageErrors[item.id] ? "image-picker--error" : ""}`}
                        >
                          <div>
                            <strong>
                              <Camera size={15} /> 디자인 참고 이미지
                            </strong>
                            <span>
                              현재 {itemImages.length}/3장 · 사진을 추가하거나
                              기존 사진을 교체·삭제할 수 있어요.
                            </span>
                          </div>
                          <div className="image-grid">
                            {itemImages.map((image) => (
                              <figure key={image.localId}>
                                <img
                                  src={image.preview}
                                  alt={`${product.name} 디자인 참고 이미지`}
                                />
                                {product.customization.referenceImagesEnabled && (
                                  <label className="image-replace">
                                    <Pencil size={11} /> 교체
                                    <input
                                      type="file"
                                      disabled={saving || preparingImages}
                                      aria-label="디자인 참고 이미지 교체"
                                      accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                                      onChange={(event) => {
                                        void changeImages(
                                          item.id,
                                          event.target.files,
                                          image.localId,
                                        );
                                        event.target.value = "";
                                      }}
                                    />
                                  </label>
                                )}
                                <button
                                  type="button"
                                  disabled={saving || preparingImages}
                                  aria-label="디자인 참고 이미지 삭제"
                                  onClick={() =>
                                    removeEditImage(item.id, image.localId)
                                  }
                                >
                                  <Trash2 size={14} />
                                </button>
                              </figure>
                            ))}
                            {product.customization.referenceImagesEnabled &&
                              itemImages.length < 3 &&
                              totalEditImages < 20 && (
                                <label className="image-add">
                                  <ImagePlus size={20} />
                                  <span>사진 추가</span>
                                  <input
                                    type="file"
                                    disabled={saving || preparingImages}
                                    aria-label="디자인 참고 이미지 추가"
                                    accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
                                    multiple
                                    onChange={(event) => {
                                      void changeImages(
                                        item.id,
                                        event.target.files,
                                      );
                                      event.target.value = "";
                                    }}
                                  />
                                </label>
                              )}
                          </div>
                          {imageErrors[item.id] && (
                            <p className="image-picker__error" role="alert">
                              {imageErrors[item.id]}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              <h3>현금영수증</h3>
              <div className="form-grid">
                <Field label="신청 유형" full>
                  <select
                    value={draft.cashReceiptType}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        cashReceiptType: event.target
                          .value as CustomerOrderUpdateInput["cashReceiptType"],
                      }))
                    }
                  >
                    <option value="none">신청 안 함</option>
                    <option value="personal">개인 소득공제용</option>
                    <option value="business">사업자 지출증빙용</option>
                  </select>
                </Field>
                {draft.cashReceiptType !== "none" && (
                  <Field label="발급 번호" full>
                    <input
                      value={draft.cashReceiptIdentifier}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          cashReceiptIdentifier: event.target.value,
                        }))
                      }
                    />
                  </Field>
                )}
              </div>
              <p className="field__hint">
                상품 개수 변경은 카카오톡 채널로 문의해주세요.
              </p>
              {error && <p className="form-error">{error}</p>}
              <div className="form-actions">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={saving || preparingImages}
                  onClick={cancelEditing}
                >
                  취소
                </Button>
                <Button
                  type="button"
                  disabled={saving || preparingImages}
                  onClick={() => void save()}
                >
                  {preparingImages
                    ? "사진 처리 중…"
                    : saving
                      ? uploadLabel || "저장 중…"
                      : "변경 저장"}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>
      <p className="support-note">
        취소·환불 또는 주문 변경이 필요하신가요?{" "}
        <a href={order.kakaoChannelUrl} target="_blank" rel="noreferrer">
          카카오톡 채널로 문의하기
        </a>
      </p>
    </>
  );
}

function Field({
  label,
  full = false,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={`field ${full ? "field--full" : ""}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}
