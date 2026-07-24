---
name: security-baseline
description: Enforces fail-closed authentication and authorization, validated configuration, safe HTTP boundaries, secret redaction, abuse controls, and production-safe error handling.
---

# Security Baseline Skill

## When to use

Sử dụng skill này khi:

* Phát triển hoặc sửa API route.
* Tạo HTTP controller, middleware hoặc request mapper.
* Thiết kế authentication hoặc authorization.
* Xử lý `ActorContext`.
* Cấu hình biến môi trường hoặc secret.
* Thiết lập logging và error handling.
* Thiết lập security headers, CORS hoặc CSRF protection.
* Thiết lập request body limit hoặc rate limiting.
* Tạo internal route, test provider hoặc development authentication.
* Xử lý timestamp, timezone hoặc dữ liệu nhạy cảm.
* Viết security tests.
* Chuẩn bị production build.

## Mandatory rules

### 1. Thứ tự tài liệu

Trước khi thay đổi security behavior, agent phải đọc:

1. Binding Reviewer Amendments mới nhất.
2. Prompt của phase hiện tại.
3. Domain Contract đã duyệt.
4. `AGENTS.md`.
5. Skill này.

Skill này không được ghi đè authentication hoặc role contract riêng của phase hiện tại.

### 2. Environment validation

Các biến môi trường bắt buộc phải được validate bằng schema tại thời điểm boot hoặc runtime initialization phù hợp.

Validation phải:

* Kiểm tra biến bắt buộc.
* Kiểm tra kiểu và phạm vi giá trị.
* Kiểm tra environment name.
* Kiểm tra secret tối thiểu theo policy nếu phase sử dụng secret.
* Fail fast khi cấu hình không hợp lệ.
* Không in giá trị secret trong error hoặc log.
* Không sử dụng giá trị mặc định không an toàn trong production.

Production không được khởi động với:

* Authentication provider giả.
* Secret mẫu.
* Database URL thiếu hoặc không hợp lệ.
* Cấu hình authorization bị tắt.
* Internal test mode đang bật.

File `.env`, private key, token và credentials không được commit.

Chỉ được commit file mẫu như `.env.example` với giá trị giả không dùng được.

### 3. Authentication abstraction

Authentication phải đi qua interface hoặc abstraction được duyệt, ví dụ:

* `AuthenticationProvider`
* `ActorContextProvider`

Domain và application layer không phụ thuộc trực tiếp vào JWT, cookie, Next.js hoặc HTTP header.

Authentication provider phải:

* Xác minh credential ở presentation/infrastructure boundary.
* Tạo `ActorContext` đã được xác thực.
* Không nhận role hoặc actor identity từ request body.
* Không tin header như `X-Role`, `X-Actor-Id` do client tùy ý gửi.
* Không cho phép anonymous actor truy cập route được bảo vệ.
* Fail closed khi provider lỗi hoặc không xác minh được credential.

Phase 1A không cần xây hệ thống phát hành JWT hoàn chỉnh nếu prompt không yêu cầu.

Nếu sử dụng mock hoặc test provider:

* Chỉ được inject trong test environment.
* Không được chọn bằng HTTP header.
* Không được tồn tại trong production dependency graph nếu có thể.
* Production phải fail nếu mock provider được cấu hình.

### 4. Authorization và RBAC

Authorization phải được thực hiện ở server.

Quy tắc mặc định:

`Default deny`

Chỉ cho phép hành động được role matrix hoặc permission contract cấp rõ ràng.

Đối với contract hiện tại:

* `ADMIN`: quyền đọc và ghi được phase cho phép.
* `VIEWER`: chỉ đọc.
* `SYSTEM`: chỉ dùng cho internal service hoặc worker đã được xác thực theo contract; không phải role công khai do client chọn.

Mỗi write operation phải kiểm tra authorization trước application service hoặc ngay tại application boundary được duyệt.

Không được chỉ ẩn nút UI rồi xem đó là authorization.

Không được tin:

* Role từ query string.
* Role từ request body.
* Actor ID từ client.
* Client-side permission checks.

Resource-level authorization phải được kiểm tra khi phase có dữ liệu theo tenant, owner hoặc scope.

### 5. Input validation

Mọi input bên ngoài phải được validate trước khi gọi application service:

* Path parameter.
* Query parameter.
* Header bắt buộc.
* Request body.
* Pagination.
* Enum.
* Date.
* BigInt decimal string.
* Idempotency key.
* Expected version.

Validation phải:

* Dùng strict schema khi phù hợp.
* Từ chối unknown fields nếu chúng có thể gây mass assignment.
* Không truyền nguyên request body trực tiếp vào Prisma `create` hoặc `update`.
* Giới hạn chiều dài chuỗi.
* Giới hạn kích thước mảng.
* Kiểm tra định dạng `YYYY-MM-DD`.
* Kiểm tra BigInt string trước khi chuyển đổi.
* Không dùng `eval`, dynamic code execution hoặc unsafe deserialization.

Content type phải được kiểm tra cho write API. Không parse tùy tiện nội dung không được hỗ trợ.

### 6. Request body limit

Write API phải có giới hạn kích thước request body phù hợp.

Khi vượt giới hạn:

* Từ chối trước khi xử lý nghiệp vụ.
* Trả mã lỗi ổn định, ví dụ `PAYLOAD_TOO_LARGE`.
* Không ghi toàn bộ payload vào log.
* Không để request chiếm bộ nhớ không giới hạn.

Giới hạn phải được cấu hình hoặc định nghĩa tập trung, không rải rác tùy ý trong từng route.

### 7. Rate limiting

Write API phải có rate limiting qua abstraction, ví dụ:

* `RateLimiter`
* `ProductionRateLimiter`
* `NoOpTestRateLimiter`

Không tạo bypass bằng HTTP header, query parameter hoặc secret token do client gửi.

Rate-limit key phải được lựa chọn rõ ràng, ví dụ:

* Authenticated actor.
* API credential.
* IP đã được xác định an toàn.
* Kết hợp actor và route.

Khi dùng IP:

* Phải cấu hình trust proxy đúng.
* Không tin tùy tiện `X-Forwarded-For`.
* Không cho client giả mạo IP để né limit.

Rate limiter phải:

* Có policy cụ thể.
* Trả lỗi ổn định như `RATE_LIMITED`.
* Không làm lộ thông tin nội bộ.
* Không vô hiệu hóa production authorization khi rate-limit backend lỗi.
* Có test provider thông qua dependency injection hoặc test configuration.

### 8. Security headers

HTTP response phải có các security headers phù hợp với kiến trúc ứng dụng.

Tối thiểu xem xét:

* `Content-Security-Policy` khi có giao diện web.
* `X-Content-Type-Options: nosniff`.
* `Referrer-Policy`.
* `Permissions-Policy`.
* Frame protection bằng CSP `frame-ancestors` hoặc cơ chế phù hợp.
* HSTS khi production chạy HTTPS.
* Cache control cho response chứa dữ liệu nhạy cảm.

Không bắt buộc dùng Helmet nếu framework có cơ chế native phù hợp.

Không cấu hình CSP bằng `unsafe-eval` hoặc `unsafe-inline` nếu không có lý do được review.

### 9. CORS và CSRF

CORS phải:

* Mặc định same-origin hoặc allowlist rõ ràng.
* Không dùng wildcard origin cùng credentials.
* Không phản chiếu tùy tiện `Origin`.
* Chỉ cho phép method và header cần thiết.

Nếu authentication sử dụng cookie:

* Cookie phải có `HttpOnly`.
* Cookie production phải có `Secure`.
* Cấu hình `SameSite` phù hợp.
* Write request phải có CSRF protection phù hợp với kiến trúc.

Nếu dùng bearer token không dựa trên cookie, phải ghi rõ CSRF không áp dụng theo cơ chế đó, nhưng CORS và token protection vẫn bắt buộc.

Không tự thêm một cơ chế authentication mới chỉ để đáp ứng skill nếu phase chưa yêu cầu.

### 10. Structured error handling

Production API phải trả structured error envelope, ví dụ:

```json
{
  "error": {
    "code": "RUN_VERSION_CONFLICT",
    "message": "Dữ liệu đã thay đổi. Vui lòng tải lại và thử lại.",
    "requestId": "..."
  }
}
```

Error contract phải:

* Có mã lỗi ổn định.
* Có thông điệp an toàn cho client.
* Có `requestId` hoặc correlation ID.
* Không trả stack trace.
* Không trả Prisma error code.
* Không trả SQL.
* Không trả database host.
* Không trả file path nội bộ.
* Không trả token hoặc secret.
* Không trả chi tiết authentication verification.

Lỗi nội bộ phải được map sang lỗi public an toàn.

Không biến mọi lỗi thành HTTP 200.

Không trả lỗi validation, authorization và concurrency bằng cùng một mã lỗi chung.

### 11. Logging và secret redaction

Logging phải dùng structured logging khi project hỗ trợ.

Bắt buộc redact:

* Authorization header.
* Cookie.
* API key.
* Access token.
* Refresh token.
* Password.
* Database URL.
* Connection string.
* Private key.
* Client secret.
* Session ID nhạy cảm.
* Query parameter chứa token.
* Nested object có key nhạy cảm.

Không log toàn bộ request body theo mặc định.

Không log credential thất bại ở dạng raw.

Request log được phép chứa:

* Request ID.
* Route.
* Method.
* Status.
* Duration.
* Actor business key khi contract cho phép và không nhạy cảm.
* Error code công khai.

Không được log secret rồi cố xóa sau.

### 12. Internal routes và test hooks

Internal test routes, debug routes và test hooks:

* Không được tồn tại trong production routing table.
* Không được bảo vệ chỉ bằng một header bí mật.
* Không được dựa vào một query parameter để bật.
* Không được expose database reset, actor impersonation hoặc security bypass.

Nếu cần test:

* Sử dụng dependency injection.
* Test configuration.
* Test-only module.
* Direct application service invocation.
* Database fixture trong môi trường cô lập.

Production build phải có kiểm tra chứng minh test route không được bundle hoặc expose.

### 13. Time and date safety

Timestamp:

* Lưu UTC trong database.
* Trả UTC ISO-8601 qua API trừ khi presentation contract quy định khác.
* Hiển thị `Asia/Ho_Chi_Minh` ở presentation layer.

PostgreSQL `DATE`:

* Dùng `YYYY-MM-DD`.
* Không qua timezone conversion.
* Không dùng JavaScript `Date` nếu có nguy cơ đổi ngày.

Không dùng client-provided timestamp làm security audit time nếu server time mới là source of truth.

### 14. Dependency và production configuration

Khi thêm dependency liên quan đến security:

* Dùng package cần thiết và có phạm vi nhỏ.
* Không thêm package chỉ vì tên gọi “security”.
* Không dùng package deprecated hoặc không còn bảo trì nếu có lựa chọn phù hợp.
* Lockfile phải được cập nhật đúng.
* Không vô hiệu hóa security check để build qua.

Production configuration phải:

* Tắt verbose error.
* Tắt debug mode.
* Không có source map công khai nếu policy không cho phép.
* Không có test credentials.
* Không có development authentication fallback.

Không tự nâng cấp dependency diện rộng ngoài phạm vi phase.

## Forbidden actions

Agent không được:

* Commit `.env` hoặc secret.
* Log Authorization header, cookie, token, password hoặc Database URL.
* Tin role hoặc actor identity do client gửi.
* Xem việc ẩn nút hoặc chức năng trên UI là biện pháp authorization thay cho kiểm tra quyền ở server.
* Dùng default allow.
* Bỏ authentication vì “API nội bộ”.
* Tạo mock authentication hoạt động trong production.
* Tạo bypass HTTP header cho test.
* Tạo debug hoặc test route trong production.
* Truyền request body trực tiếp vào Prisma.
* Cho phép mass assignment.
* Trả stack trace, SQL, Prisma error hoặc database host.
* Dùng wildcard CORS cùng credentials.
* Phản chiếu Origin tùy tiện.
* Tắt CSRF protection khi dùng cookie authentication mà không có giải pháp tương đương.
* Tin `X-Forwarded-For` khi chưa cấu hình trusted proxy.
* Tắt rate limiting bằng client-controlled input.
* Log toàn bộ payload nhạy cảm.
* Dùng client timestamp làm audit source of truth.
* Che giấu security test failure.
* Tự giảm security requirement để code dễ hơn.

## Required evidence

Báo cáo implementation phải có:

* Environment schema và boot validation.
* Danh sách biến bắt buộc, không ghi giá trị secret.
* Authentication abstraction.
* Production authentication provider hoặc placeholder contract theo phase.
* ActorContext source.
* Authorization role matrix.
* Default-deny behavior.
* Input validation schemas.
* Unknown-field hoặc mass-assignment protection.
* Request body limit.
* Rate-limit abstraction và key strategy.
* Trusted proxy strategy nếu dùng IP.
* Security headers.
* CORS policy.
* CSRF policy hoặc lý do không áp dụng.
* Structured error envelope.
* Internal-to-public error mapping.
* Request ID strategy.
* Logging fields được phép.
* Secret-redaction rules.
* Internal test-route production exclusion.
* UTC/timestamp và PostgreSQL DATE strategy.
* Known security limitations.

Bằng chứng kiểm thử phải bao phủ các mục thuộc phạm vi phase hiện tại:

* Missing environment variable làm boot thất bại.
* Secret không xuất hiện trong log.
* Unauthenticated request bị từ chối.
* Unauthorized role bị từ chối.
* VIEWER không gọi được write API.
* ADMIN thực hiện được hành động được cấp.
* Client không thể tự chọn role hoặc actor.
* Unknown field bị từ chối khi contract yêu cầu strict validation.
* Payload quá lớn bị từ chối.
* Rate limit hoạt động.
* Client không bypass rate limit bằng header.
* Production error không có stack hoặc Prisma details.
* Error response có request ID.
* Internal test route không tồn tại trong production.
* Security headers tồn tại.
* CORS policy đúng.
* CSRF test nếu dùng cookie authentication.
* PostgreSQL DATE không lệch ngày.
* UTC timestamp đúng.

Nhóm không thuộc phạm vi phải ghi:

`Not applicable to current phase`

Không được tạo authentication system hoặc security feature của phase sau chỉ để đáp ứng skill chung.

## Stop conditions

Agent phải dừng và báo cáo khi:

* Phát hiện secret trong source, commit, log hoặc error.
* Không xác định được authentication source.
* Production có thể chạy bằng mock authentication.
* Authorization không thể thực hiện default deny.
* Client có thể tự khai báo role hoặc actor.
* Route nhạy cảm chưa được authentication hoặc authorization bảo vệ.
* Internal test route hoặc bypass tồn tại trong production.
* Cần tạo bypass HTTP để test.
* Không thể redact secret khỏi log.
* Error production vẫn lộ stack, Prisma, SQL hoặc database host.
* CORS cho phép origin không kiểm soát cùng credentials.
* Cookie authentication không có CSRF strategy.
* Rate limiter có thể bị né bằng client-controlled header.
* Trusted proxy chưa được xác định nhưng rate limit phụ thuộc IP.
* Test đang yêu cầu security requirement bị làm yếu.
* Security test quan trọng vẫn FAIL.
* Không thể chứng minh production build loại bỏ test hooks.
* Security behavior mâu thuẫn với Domain Contract hoặc Reviewer Amendment.
* Việc sửa yêu cầu mở rộng ngoài phạm vi phase.

Khi dừng, agent phải báo cáo:

* Vấn đề phát hiện.
* Route hoặc module bị ảnh hưởng.
* Mức độ rủi ro.
* Log hoặc bằng chứng đã được redacted.
* Phần đã xác minh.
* Phần chưa xác minh.
* Quyết định cần Reviewer đưa ra.

Không tiếp tục bằng giải pháp bypass hoặc giảm yêu cầu bảo mật khi chưa được phê duyệt.
