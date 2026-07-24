---
name: domain-and-invariants
description: Preserves approved Domain Contracts, state machines, deterministic identities, financial precision, point-in-time rules, and immutable data invariants.
---

# Domain and Invariants Skill

## When to use

Sử dụng skill này khi:

* Thiết kế hoặc triển khai entity nghiệp vụ.
* Thay đổi domain service hoặc application service có logic nghiệp vụ.
* Thêm hoặc sửa state transition.
* Xử lý tiền tệ, giá vốn, số lượng hoặc làm tròn.
* Tạo business key hoặc deterministic hash.
* Xử lý PostgreSQL `DATE`, timestamp hoặc point-in-time data.
* Làm việc với dữ liệu sealed, posted, append-only hoặc immutable.
* Tạo projection hoặc snapshot từ source of truth.

## Mandatory rules

### 1. Tài liệu phải đọc trước khi sửa domain

Agent phải đọc và áp dụng theo đúng thứ tự:

1. Binding Reviewer Amendments mới nhất.
2. Prompt của phase hiện tại.
3. Domain Contract đã duyệt.
4. `AGENTS.md`.
5. Skill này.

Không được dùng skill này để ghi đè quyết định riêng của phase.

### 2. State-transition contract

Mọi state transition phải:

* Validate trạng thái nguồn.
* Validate trạng thái đích.
* Validate mode hoặc loại aggregate khi có áp dụng.
* Validate preconditions nghiệp vụ.
* Validate `expectedVersion`.
* Có idempotency contract.
* Có optimistic locking khi aggregate có thể bị cập nhật đồng thời.
* Tạo append-only event.
* Cập nhật aggregate và tạo event trong cùng database transaction.
* Tăng version đúng một lần.
* Không tạo event trùng khi request được retry.
* Ghi actor, reason và request identity theo contract.
* Chặn mọi transition không có trong state-transition table đã duyệt.

Không được tự suy ra transition mới chỉ vì code có thể hỗ trợ.

### 3. Deterministic business identity

Business key và deterministic hash:

* Không được chứa database UUID.
* Không được chứa wall-clock timestamp.
* Không được chứa `createdAt`, `recordedAt` hoặc insertion order.
* Không được phụ thuộc query order của database.
* Không được dùng primary key ngẫu nhiên của entity cha.

Stable business key của entity con phải được xây từ stable business key của entity cha và sequence nghiệp vụ deterministic.

Ví dụ:

* Dùng `orderBusinessKey`, không dùng `orderId`.
* Dùng `runBusinessKey`, không dùng `runId`.
* Dùng `canonicalSecurityKey`, không dùng ticker hoặc security UUID.

### 4. Canonical serialization

Trước khi hash, dữ liệu phải được canonicalize theo contract đã duyệt:

* JSON keys được sắp xếp cố định.
* Mảng được sắp xếp bằng stable business key rõ ràng.
* `null` được biểu diễn là JSON `null`.
* Chuỗi được chuẩn hóa Unicode NFC.
* Enum dùng uppercase.
* BigInt dùng decimal string.
* Không dùng scientific notation.
* PostgreSQL `DATE` dùng `YYYY-MM-DD`.
* Timestamp dùng UTC ISO-8601.
* Không tự gộp các dòng trùng nếu contract không quy định.
* Mỗi dòng phải có deterministic sequence hoặc unique business key.

Hai môi trường có cùng đầu vào nghiệp vụ phải tạo cùng hash dù UUID và thời điểm insert khác nhau.

### 5. Tiền tệ và BigInt

Mọi tiền VND phải:

* Lưu bằng BigInt hoặc integer type tương đương.
* Nhận và trả qua JSON dưới dạng decimal string khi vượt giới hạn an toàn của JavaScript.
* Không chuyển qua JavaScript `number`.
* Không dùng floating point để tính phí, thuế, NAV hoặc giá vốn.
* Có quy tắc rounding rõ ràng.
* Bảo toàn tổng tiền chính xác đến 1 VND.

Khi phân bổ giá vốn:

```text
allocatedCost =
floor(totalCarryingCost × allocatedQuantity ÷ totalQuantity)
```

Phần dư làm tròn phải được phân bổ vào phần cuối cùng theo Domain Contract.

Bất biến:

```text
Tổng giá vốn đã phân bổ
+ Giá vốn còn lại
= Tổng giá vốn ban đầu
```

Không được tự sinh hoặc thất thoát 1 VND.

### 6. Quantity và tỷ lệ

* Số lượng cổ phiếu nguyên dùng integer.
* Không dùng floating point cho quantity nếu hệ thống chưa hỗ trợ fractional holdings.
* Tỷ lệ phải lưu bằng rational representation, basis points hoặc decimal contract đã duyệt.
* Fraction treatment phải tuân theo Corporate Action Contract của từng sự kiện.
* Không hardcode rounding hoặc cash-out rule toàn hệ thống.

### 7. Date, time và point-in-time

PostgreSQL `DATE`:

* Dùng chuỗi `YYYY-MM-DD`.
* Không tạo JavaScript `Date` rồi chuyển UTC để lưu.
* Không áp dụng timezone conversion.
* Không được làm lệch ngày tại ranh giới nửa đêm.

Timestamp:

* Lưu UTC.
* Chỉ chuyển sang `Asia/Ho_Chi_Minh` ở presentation layer.

Point-in-time data:

* Không đọc dữ liệu có `availableAt` sau simulation cutoff.
* Không thay revision hiện tại vào snapshot lịch sử đã sealed.
* Không sửa dữ liệu quá khứ để phản ánh thông tin xuất hiện sau đó.
* Mọi correction phải dùng revision, correction event hoặc reversal theo contract.

### 8. Immutability

Dữ liệu được đánh dấu là:

* sealed
* posted
* append-only
* immutable

không được update hoặc delete, trừ khi Domain Contract quy định rõ cơ chế correction, reversal hoặc replacement riêng.

Việc một entity là `source of truth` không tự động có nghĩa entity đó bất biến.

Khả năng thay đổi của một source of truth phải tuân theo:

* Entity classification.
* Mutability Contract.
* State machine.
* Domain Contract.
* Binding Reviewer Amendments.

Một Controlled Mutable Aggregate chỉ được cập nhật thông qua các transition hoặc command đã được duyệt, có validation, optimistic locking, idempotency, event và transaction boundary theo contract.

Mọi correction phải dùng:

* Event mới.
* Revision mới.
* Reversal entry.
* Replacement snapshot.

Không được sửa record cũ tại chỗ.

Bất biến phải được bảo vệ ở:

* Domain/application layer.
* Repository layer.
* Database constraint, trigger hoặc permission khi contract yêu cầu.

### 9. Source of truth và projection

* Source of truth không được sửa để khớp projection.
* Projection phải có khả năng rebuild từ source of truth khi contract yêu cầu.
* Không ghi trực tiếp projection để che lỗi event hoặc ledger.
* Nếu projection lệch, phải tìm và sửa nguyên nhân trong source event hoặc transformation logic.
* Snapshot immutable không được cập nhật lại sau khi khóa.

## Forbidden actions

Agent không được:

* Tự thay đổi state machine.
* Bỏ qua precondition của transition.
* Tạo transition không có trong contract.
* Dùng UUID hoặc timestamp trong deterministic identity.
* Dùng ticker làm foreign key.
* Dùng floating point cho tiền VND.
* Chuyển BigInt qua JavaScript `number`.
* Tự chọn rounding rule khi contract chưa quy định.
* Dùng JavaScript `Date` cho PostgreSQL `DATE`.
* Update hoặc delete sealed, posted hoặc append-only records.
* Tách aggregate update và event insert thành hai transaction.
* Sửa projection để che lỗi source of truth.
* Thay dữ liệu lịch sử bằng revision mới hơn.
* Bỏ qua idempotency hoặc optimistic locking để đơn giản hóa implementation.
* Sửa test expectation để hợp thức hóa domain logic sai.

## Required evidence

Báo cáo implementation phải có:

* Domain Contract và Reviewer Amendments đã áp dụng.
* State-transition table đã triển khai.
* Preconditions của từng transition.
* Transaction boundary.
* Versioning và optimistic locking strategy.
* Idempotency strategy.
* Business-key formula.
* Canonical hash fields và serialization rules.
* Money representation và rounding rule.
* Date/time representation.
* Immutability protection.
* Projection/source-of-truth relationship.

Bằng chứng kiểm thử phải bao phủ các mục dưới đây khi invariant tương ứng thuộc phạm vi của phase hiện tại:

* Transition hợp lệ.
* Transition bị cấm.
* Idempotent retry.
* Concurrent transition.
* Atomic rollback aggregate/event.
* Deterministic hash độc lập UUID.
* Hash độc lập insertion order.
* BigInt không mất precision.
* Rounding bảo toàn 1 VND.
* PostgreSQL `DATE` không lệch ngày.
* Sealed/posted record không update hoặc delete.
* Point-in-time cutoff không bị look-ahead.

Đối với invariant hoặc nhóm test chưa thuộc phạm vi phase hiện tại, báo cáo phải ghi rõ:

`Not applicable to current phase`

Không được tạo thêm entity, bảng, API, domain logic hoặc implementation của phase sau chỉ để đáp ứng một mục kiểm thử chung trong skill này.

Prompt của phase hiện tại và Binding Reviewer Amendments quyết định nhóm invariant nào bắt buộc phải kiểm thử trong phase đó.

## Stop conditions

Agent phải dừng và báo cáo khi:

* Domain Contract và Reviewer Amendment mâu thuẫn mà thứ tự ưu tiên không giải quyết được.
* Cần thêm state transition chưa được Reviewer duyệt.
* Chưa có rounding rule cho phép tính tiền.
* Không thể bảo toàn tiền đến 1 VND.
* Không thể thực hiện aggregate update và event insert nguyên tử.
* Không thể bảo vệ dữ liệu immutable.
* Business key bắt buộc phải phụ thuộc UUID hoặc wall-clock timestamp.
* Không xác định được point-in-time cutoff.
* Phát hiện look-ahead data leakage.
* Cần sửa dữ liệu posted hoặc sealed tại chỗ.
* Không thể tạo test chứng minh invariant quan trọng.
* Implementation hiện tại làm thay đổi Domain Contract đã khóa.

Khi dừng, agent phải mô tả invariant bị ảnh hưởng và không tự chọn giải pháp nghiệp vụ thay thế chưa được phê duyệt.
