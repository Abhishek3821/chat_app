Add-Type -AssemblyName System.IO.Compression.FileSystem

$output = Join-Path $PSScriptRoot 'docs\ChatKonect_Changes_2026-09-23.docx'
$temp = Join-Path $env:TEMP ('chatkonect-docx-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $temp | Out-Null
New-Item -ItemType Directory -Path "$temp\_rels", "$temp\word", "$temp\word\_rels" | Out-Null

function Esc([string]$value) { [System.Security.SecurityElement]::Escape($value) }
function Para([string]$text, [string]$style = 'Body', [bool]$bold = $false) {
  $b = if ($bold) { '<w:b/>' } else { '' }
  "<w:p><w:pPr><w:pStyle w:val=`"$style`"/></w:pPr><w:r><w:rPr>$b</w:rPr><w:t xml:space=`"preserve`">$(Esc $text)</w:t></w:r></w:p>"
}
function Bullet([string]$text) { "<w:p><w:pPr><w:pStyle w:val=`"Bullet`"/></w:pPr><w:r><w:t>$(Esc $text)</w:t></w:r></w:p>" }
function Cell([string]$text, [bool]$head = $false) {
  $fill = if ($head) { '<w:shd w:fill="E8EEF5"/>' } else { '' }
  $bold = if ($head) { '<w:b/>' } else { '' }
  "<w:tc><w:tcPr><w:tcW w:w=`"$([int](9360/3))`" w:type=`"dxa`"/>$fill</w:tcPr><w:p><w:r><w:rPr>$bold</w:rPr><w:t>$(Esc $text)</w:t></w:r></w:p></w:tc>"
}
function Table($rows) {
  $xml = '<w:tbl><w:tblPr><w:tblW w:w="9360" w:type="dxa"/><w:tblLayout w:type="fixed"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="B7C9D6"/><w:left w:val="single" w:sz="4" w:color="B7C9D6"/><w:bottom w:val="single" w:sz="4" w:color="B7C9D6"/><w:right w:val="single" w:sz="4" w:color="B7C9D6"/><w:insideH w:val="single" w:sz="4" w:color="D9E3EA"/><w:insideV w:val="single" w:sz="4" w:color="D9E3EA"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="1800"/><w:gridCol w:w="3000"/><w:gridCol w:w="4560"/></w:tblGrid>'
  foreach ($row in $rows) { $xml += '<w:tr>' + (Cell $row[0] ($row -eq $rows[0])) + (Cell $row[1] ($row -eq $rows[0])) + (Cell $row[2] ($row -eq $rows[0])) + '</w:tr>' }
  $xml + '</w:tbl>'
}

$body = ''
$body += Para 'ChatKonect - Change Report' 'Title'
$body += Para 'Changes completed on 23 September 2026' 'Subtitle'
$body += Para 'Purpose' 'Heading1'
$body += Para 'This report records the application changes completed today, the affected APIs, and the resulting user behavior.'
$body += Para '1. Admin user deletion' 'Heading1'
$body += Para 'A permanent Delete option was added to Admin Dashboard > User Management.'
$body += Bullet 'The admin must confirm before the deletion request is sent.'
$body += Bullet 'An administrator cannot delete their own account from the dashboard.'
$body += Bullet 'The user row is removed from the dashboard after a successful response.'
$body += Bullet 'The server removes the account and associated records: sessions, push subscriptions, contact requests, notifications, calls, status records, scheduled messages, direct-chat data, API keys, broadcast lists, and references in shared records.'
$body += Para 'Affected API' 'Heading2'
$body += Table @(
  @('Method', 'Endpoint', 'Change'),
  @('DELETE', '/api/admin/users/:id', 'New admin-only permanent account deletion endpoint.'),
  @('PATCH', '/api/admin/users/:id/status', 'Existing suspend, ban, and activate behavior remains unchanged.')
)
$body += Para 'Implementation files' 'Heading2'
$body += Bullet 'client/src/pages/AdminDashboard.jsx'
$body += Bullet 'server/controllers/adminController.js'
$body += Bullet 'server/routes/adminRoutes.js'
$body += Bullet 'server/utils/deleteUserAccount.js'
$body += Para '2. Contact request decline and resend' 'Heading1'
$body += Para 'When B declines a request from A, the request is now deleted rather than retained with a rejected status.'
$body += Bullet 'The request disappears from B''s incoming requests and A''s outgoing requests.'
$body += Bullet 'A receives a real-time update so the Requested state clears without waiting for a page refresh.'
$body += Bullet 'A can send a fresh request to B immediately after the decline.'
$body += Para 'Affected API' 'Heading2'
$body += Table @(
  @('Method', 'Endpoint', 'Change'),
  @('POST', '/api/contacts/request/:userId', 'Creates a new request after a prior decline.'),
  @('PATCH', '/api/contacts/request/:id', 'action=reject now deletes the request and returns deleted: true.'),
  @('GET', '/api/contacts/requests', 'Returns only pending incoming and outgoing requests, now with no declined row retained.')
)
$body += Para 'Real-time event' 'Heading2'
$body += Bullet 'contact-declined - sent to the original requester so their contacts state reloads.'
$body += Para 'Implementation files' 'Heading2'
$body += Bullet 'server/controllers/contactController.js'
$body += Bullet 'client/src/hooks/useSocket.js'
$body += Bullet 'server/tests/qr-invite.mjs'
$body += Para '3. Unfriend behavior for existing direct chats' 'Heading1'
$body += Para 'Unfriending no longer deletes the direct chat or its history. However, it now prevents either person from sending new messages until they become mutual contacts again.'
$body += Bullet 'A and B can still view their existing conversation and message history.'
$body += Bullet 'After A or B unfriends, every new direct-message attempt is refused with HTTP 403.'
$body += Bullet 'A new contact request must be sent and accepted.'
$body += Bullet 'After acceptance, both users can continue in the retained original chat.'
$body += Para 'Affected API' 'Heading2'
$body += Table @(
  @('Method', 'Endpoint', 'Change'),
  @('DELETE', '/api/users/me/contacts/:id', 'Existing unfriend endpoint removes the mutual contact relationship but retains chat history.'),
  @('POST', '/api/messages', 'Now checks both users are still mutual contacts before delivering a direct message.'),
  @('POST', '/api/contacts/request/:userId', 'Used to reconnect after unfriending.'),
  @('PATCH', '/api/contacts/request/:id', 'action=accept restores the mutual contact relationship and messaging permission.')
)
$body += Para 'Implementation files' 'Heading2'
$body += Bullet 'server/controllers/messageController.js'
$body += Bullet 'server/tests/chat-realtime.mjs'
$body += Para '4. Investigation: generated platform users' 'Heading1'
$body += Para 'The entries with email addresses such as u-...@app_....app.invalid are provisioned platform users, not normal account registrations. They are created when an integration calls POST /api/v1/platform/users with an application secret. The .invalid address is intentionally generated by the platform provisioning flow.'
$body += Bullet 'Suspended generated users indicate the integration called DELETE /api/v1/platform/users/:externalId, which suspends rather than deletes a platform user.'
$body += Bullet 'No code change was made for this investigation; the source was identified in server/controllers/platformController.js and server/routes/platformRoutes.js.'
$body += Para 'Verification completed' 'Heading1'
$body += Bullet 'Server JavaScript syntax checks completed for the edited controllers and tests.'
$body += Bullet 'Client production build completed successfully with Vite.'
$body += Bullet 'Regression coverage was added for declined-request resend and unfriend/reconnect messaging behavior.'

$document = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>$body<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="709" w:footer="709"/></w:sectPr></w:body></w:document>
"@

[IO.File]::WriteAllText("$temp\[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
[IO.File]::WriteAllText("$temp\_rels\.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
[IO.File]::WriteAllText("$temp\word\_rels\document.xml.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
[IO.File]::WriteAllText("$temp\word\document.xml", $document)
[IO.File]::WriteAllText("$temp\word\styles.xml", '<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/><w:sz w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Body"><w:name w:val="Body"/><w:pPr><w:spacing w:after="120" w:line="275" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:color w:val="0B2545"/><w:sz w:val="40"/></w:rPr><w:pPr><w:spacing w:after="80"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:color w:val="5B6B7A"/><w:sz w:val="22"/></w:rPr><w:pPr><w:spacing w:after="240"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="Heading 1"/><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="32"/></w:rPr><w:pPr><w:spacing w:before="280" w:after="140"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:rPr><w:b/><w:color w:val="2E74B5"/><w:sz w:val="26"/></w:rPr><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Bullet"><w:name w:val="Bullet"/><w:pPr><w:ind w:left="540" w:hanging="270"/><w:spacing w:after="80"/></w:pPr></w:style></w:styles>')

if (Test-Path $output) { Remove-Item -LiteralPath $output -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($temp, $output)
Remove-Item -LiteralPath $temp -Recurse -Force
Write-Output $output
