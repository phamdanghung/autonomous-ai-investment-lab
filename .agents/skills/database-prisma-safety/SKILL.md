---
name: database-prisma-safety
description: Enforces safe Prisma schema design, reviewable PostgreSQL migrations, isolated test databases, atomic transactions, concurrency control, and database-level invariants.
---

# Database & Prisma Safety Skill

## When to use

Sử dụng skill này khi:

* Tạo hoặc chỉnh sửa `schema.prisma`.
* Tạo, kiểm tra hoặc áp dụng migration.
* Thay đổi bảng, trường, index, foreign key hoặc constraint.
* Viết repository hoặc thao tác database.
* Thực hiện transaction.
* Xử lý optimistic locking, idempotency hoặc race condition.
* Thiết kế append-only, sealed hoặc immutable data protection.
* Viết integration test có sử dụng database thật.
* Điều tra Prisma error hoặc migration drift.

## Mandatory rules

### 1. Xác định môi trường database

Trước khi chạy bất kỳ lệnh database nào, agent phải xác định rõ:

* Database là test, development, staging hay production.
* `DATABASE_URL` đang trỏ tới đâu.
* Database test có tách biệt hoàn toàn với development và production hay không.
* Lệnh dự kiến có thể làm mất dữ liệu hay không.
* Migration hiện tại đã được apply ở môi trường nào.

Không được suy đoán database đang là test chỉ dựa vào tên file hoặc `NODE_ENV`.

Không in toàn bộ `DATABASE_URL`, password, token hoặc secret vào log.

### 2. Giới hạn schema theo phase

* Schema được phép giữ lại toàn bộ entity thuộc các phase trước đã được Reviewer PASS.
* Phase hiện tại chỉ được thêm hoặc thay đổi entity, enum, relation và field nằm trong phạm vi đã được phê duyệt.
* Không được xóa hoặc làm thay đổi bất tương thích entity của phase trước, trừ khi prompt hiện tại cho phép rõ ràng.
* Không được thêm entity, enum, relation hoặc field thuộc phase tương lai.
* Không tạo trước toàn bộ database MVP.
* Không thêm bảng, enum, relation hoặc field “để dùng sau”.
* Không tạo dependency ngược sang entity của phase sau.
* Mọi field phải có lý do nghiệp vụ hoặc hạ tầng rõ ràng.
* Mọi relation phải xác định delete behavior cụ thể.

Trước khi hoàn thành phải kiểm tra:

* Primary keys.
* Unique constraints.
* Composite unique constraints.
* Foreign keys.
* Indexes.
* Nullability.
* Default values.
* Delete and update behavior.
* Database column type thực tế.

### 3. Prisma migration lifecycle

Migration development phải:

1. Có tên rõ ràng.
2. Được tạo theo hướng cho phép review SQL trước.
3. Có SQL summary.
4. Được kiểm tra không chứa bảng hoặc thay đổi ngoài phạm vi.
5. Được kiểm tra nguy cơ mất dữ liệu.
6. Được chạy trên database test hoặc development được xác nhận.

Không được dùng `prisma db push` thay cho migration chính thức của project.

Không được sửa nội dung migration đã được apply vào môi trường dùng chung. Nếu cần thay đổi, tạo migration mới.

Production hoặc staging deployment chỉ sử dụng migration workflow đã được duyệt, ví dụ `prisma migrate deploy`; không chạy `migrate dev` trên production.

### 4. Lệnh phá dữ liệu

Mặc định cấm:

* `prisma migrate reset`
* `prisma db push --force-reset`
* `DROP DATABASE`
* `DROP SCHEMA`
* `TRUNCATE` ngoài database test cô lập
* Script xóa dữ liệu hàng loạt
* Xóa migration history
* Chỉnh trực tiếp bảng migration của Prisma

Chỉ được sử dụng thao tác phá dữ liệu khi:

* Database được chứng minh là test tạm thời và cô lập.
* Prompt hiện tại cho phép rõ ràng.
* Agent báo trước lệnh và tác động.
* Không có nguy cơ trỏ nhầm sang development hoặc production.

### 5. PostgreSQL type contract

* Tiền VND và các giá trị yêu cầu integer chính xác phải dùng BigInt hoặc kiểu integer phù hợp.
* BigInt API không được đi qua JavaScript `number`.
* PostgreSQL `DATE` phải đại diện bằng `YYYY-MM-DD`.
* Không chuyển PostgreSQL `DATE` qua timezone.
* Timestamp phải lưu UTC.
* Decimal phải có precision và scale được Domain Contract quy định.
* Không dùng floating point cho tiền hoặc giá vốn.

Nếu Prisma không thể biểu diễn đầy đủ constraint hoặc type cần thiết, migration SQL phải bổ sung rõ ràng và có integration test.

### 6. Atomic transaction

Các thao tác aggregate và event phải atomic khi Domain Contract yêu cầu.

Transaction phải:

* Sử dụng Prisma interactive transaction khi cần nhiều bước phụ thuộc.
* Có transaction boundary rõ ràng.
* Không gọi external network service bên trong transaction.
* Không giữ transaction mở lâu hơn cần thiết.
* Rollback toàn bộ nếu một bước bắt buộc thất bại.
* Không cập nhật aggregate thành công nếu event insert thất bại.

Application service không được gọi nhiều repository method rời rạc ngoài transaction rồi giả định chúng nguyên tử.

### 7. Optimistic concurrency

CAS phải dùng tối thiểu:

* Aggregate `id`.
* `version`.
* `expectedStatus` hoặc trạng thái nguồn phù hợp.

Ví dụ logic:

```text
WHERE id = runId
AND version = expectedVersion
AND status = expectedStatus
```

Update phải kiểm tra affected rows bằng đúng `1`.

Nếu affected rows bằng `0`, trả conflict nghiệp vụ phù hợp; không tự retry như một lỗi tạm thời.

Version chỉ tăng một lần cho mỗi transition thành công.

Event sequence phải tuân theo Domain Contract và được tạo trong cùng transaction.

### 8. Unique-constraint race handling

Phải xử lý các race như:

* Concurrent config creation cùng content hash.
* Concurrent idempotent request cùng key.
* Concurrent insertion cùng business key.
* Concurrent event sequence.

Đối với Prisma `P2002` hoặc lỗi unique constraint tương đương:

* Xác định constraint nào bị vi phạm.
* Không chuyển mọi `P2002` thành cùng một lỗi nghiệp vụ.
* Khi contract cho phép idempotent replay, đọc lại record thắng cuộc.
* So sánh request hash hoặc business payload.
* Trả kết quả cũ nếu cùng key và cùng payload.
* Trả `IDEMPOTENCY_KEY_REUSED` nếu cùng key nhưng khác payload.
* Không trả lỗi 500 cho race đã được contract dự kiến.

### 9. Transaction retry

Chỉ retry những lỗi được xác định là tạm thời, ví dụ:

* Deadlock.
* Serialization failure.
* Một số connection interruption được policy cho phép.

Retry phải:

* Có số lần tối đa.
* Có backoff phù hợp.
* Không retry validation error.
* Không retry invalid state transition.
* Không retry CAS conflict.
* Không retry idempotency payload conflict.
* Không tạo side effect ngoài database trước khi transaction commit.

### 10. Database-level invariants

Không chỉ phụ thuộc vào application guard khi invariant có thể bị phá qua:

* Raw SQL.
* Script bảo trì.
* Repository khác.
* Worker khác.
* Phiên bản ứng dụng cũ.

Khi contract yêu cầu, dùng một hoặc nhiều cơ chế:

* Unique constraint.
* Check constraint.
* Foreign key.
* Trigger.
* Restricted database permission.
* Append-only table policy.

Các invariant như sau phải có database protection nếu thuộc phạm vi phase:

* Event append-only.
* Sealed config không update/delete.
* Posted hoặc sealed record không sửa tại chỗ.
* Immutable business fields không thay đổi.
* Composite sequence không trùng.

Nếu Prisma schema không biểu diễn được constraint, ghi rõ phần SQL migration thủ công.

### 11. Test database

Integration test phải chạy trên database riêng.

Test setup phải:

* Không sử dụng production database.
* Không dùng chung dữ liệu development nếu test có ghi/xóa.
* Có cơ chế xác nhận database target trước khi chạy.
* Có cleanup an toàn.
* Không dựa vào thứ tự chạy test.
* Không để test song song gây trùng dữ liệu ngoài chủ đích.
* Có seed tối thiểu, deterministic.

Không được dùng bypass HTTP hoặc phá invariant production chỉ để test dễ hơn.

### 12. Migration verification

Trước khi báo cáo hoàn thành, phải kiểm tra:

* Migration SQL thực tế.
* Prisma schema validation.
* Migration status.
* Drift nếu công cụ hỗ trợ.
* Bảng, cột và constraint sau apply.
* Seed chạy đúng phạm vi.
* Production build không phụ thuộc migration chưa apply.

Nếu phát hiện drift, không tự sửa database hoặc migration history. Dừng và báo cáo.

## Forbidden actions

Agent không được:

* Xóa bảng, field, relation, constraint hoặc index của phase trước mà prompt hiện tại không cho phép.
* Tạo trước toàn bộ database MVP.
* Thêm bảng hoặc field của phase sau.
* Dùng `db push` để né migration review.
* Chạy `migrate reset` trên database không được xác nhận là test cô lập.
* Chỉnh migration đã apply để làm lịch sử “đẹp hơn”.
* Xóa migration history.
* Bỏ foreign key hoặc unique constraint chỉ để test qua.
* Dùng cascade delete mặc định khi chưa phân tích tác động.
* Dựa hoàn toàn vào application guard cho dữ liệu immutable.
* Bắt mọi Prisma error rồi trả một lỗi chung không phân loại.
* Retry vô hạn.
* Retry CAS conflict hoặc lỗi nghiệp vụ.
* Giữ transaction mở trong lúc gọi API bên ngoài.
* Chạy migration production khi chưa được Reviewer cho phép.
* In secret hoặc database credentials vào log.
* Dùng test database chung với production hoặc development có dữ liệu thật.

## Required evidence

Báo cáo implementation phải có:

* Database environment được sử dụng.
* Danh sách model được tạo hoặc thay đổi.
* Schema fields.
* Database column types.
* Primary keys.
* Unique constraints.
* Composite constraints.
* Foreign keys.
* Indexes.
* Delete behavior.
* Migration name.
* Migration SQL summary.
* Migration status.
* Drift status nếu đã kiểm tra.
* Transaction boundaries.
* CAS implementation.
* Unique-race handling.
* Retry policy.
* Database immutability mechanism.
* Seed summary.
* Known migration risks.

Bằng chứng kiểm thử phải bao phủ các mục liên quan đến phase hiện tại:

* Atomic commit.
* Atomic rollback.
* CAS conflict.
* Concurrent update.
* Unique-constraint race.
* Idempotent retry race.
* Database-level immutability.
* Foreign-key behavior.
* BigInt precision.
* PostgreSQL `DATE`.
* Migration apply trên database test.
* Seed idempotency hoặc deterministic seed behavior.

Mục không thuộc phạm vi phase phải ghi:

`Not applicable to current phase`

Không được tạo implementation của phase sau chỉ để đáp ứng skill này.

## Stop conditions

Agent phải dừng và báo cáo khi:

* Không xác định chắc chắn database target.
* Có nguy cơ đang thao tác trên production.
* Cần destructive migration nhưng chưa được Reviewer duyệt.
* Migration có nguy cơ mất dữ liệu.
* Cần reset database mới tiếp tục được.
* Phát hiện migration drift.
* Migration chứa bảng hoặc field ngoài phase.
* Cần chỉnh migration đã apply.
* Prisma không biểu diễn được invariant và chưa có SQL strategy được duyệt.
* Không thể bảo vệ dữ liệu immutable ở database khi contract yêu cầu.
* Không thể thực hiện transaction nguyên tử.
* Không xử lý được unique-constraint race.
* Integration test chỉ có thể chạy trên production, staging hoặc development database dùng chung/có dữ liệu thật.

Integration test được phép và nên sử dụng một PostgreSQL database thật dành riêng cho test, với điều kiện database đó:

* Được cô lập hoàn toàn.
* Không chứa dữ liệu production hoặc dữ liệu người dùng.
* Có connection string riêng.
* Được xác minh target trước khi chạy.
* Có cleanup an toàn.

* Test database không được cô lập.
* Build hoặc migration verification thất bại.
* Implementation hiện tại yêu cầu xóa hoặc thay đổi bất tương thích dữ liệu của phase trước nhưng chưa có Reviewer approval.

Khi dừng, agent phải ghi rõ:

* Lệnh đã chạy.
* Database environment.
* Lỗi thực tế.
* Nguy cơ dữ liệu.
* Phần chưa được xác minh.
* Đề xuất cần Reviewer quyết định.

Không tự thực hiện giải pháp phá dữ liệu hoặc thay đổi contract khi chưa được phê duyệt.
