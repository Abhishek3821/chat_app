// Product inventory, checked against the local source on 20 October 2026.
// One module, its access/context, source references, then its individual features.
export const modules = [];
const add = (title, access, sources, items) => modules.push({title, access, sources: sources.split('|'), features: items.trim().split('\n').map(s=>s.trim()).filter(Boolean)});

add('Account signup and onboarding','Public signup; email delivery depends on configured provider','server/controllers/authController.js|client/src/pages/auth/Signup.jsx',`
Create an individual Personal account.
Create a new team workspace during signup.
Join an existing team using its invite code or invite link.
Join selected team groups through a limited guest signup link.
Enter name, email, phone number, password and password confirmation.
Check duplicate email and phone registrations.
Normalize phone numbers for account matching.
Automatically generate a unique username from the email address.
Accept a valid explicit username from compatible API clients.
Upload or supply an optional signup avatar; use a fallback avatar otherwise.
Send a signup email verification code when verification is enabled.
Verify the email code before submitting signup.
Resend an email verification code.
Expire verification codes and limit incorrect verification attempts.
Issue a time-limited proof after successful email verification.
Reject invalid workspace invitations before creating the account.
Create a signed-in session after successful signup.
Retain compatibility with the account OTP verification and resend endpoints.
`);
add('Login and password recovery','Account holders; email recovery requires delivery configuration','server/controllers/authController.js|client/src/pages/auth/Login.jsx|client/src/pages/auth/ForgotPassword.jsx|client/src/pages/auth/ResetPassword.jsx',`
Sign in using email and password.
Sign in using username and password.
Sign in using phone number and password, including normalized number matching.
Show or hide password text in authentication forms.
Reject incorrect credentials with a readable response.
Reject suspended or banned accounts.
Require verified accounts when email verification is enabled.
Request a forgotten-password recovery link.
Return a generic recovery acknowledgement to protect account existence.
Reset the password using an expiring recovery token.
Change the current password from account settings.
Invalidate old tokens and sessions after password changes or resets.
Refresh an expired access session using the refresh cookie.
Rotate refresh credentials rather than reusing the old refresh token.
Log out of the current session.
Restore the signed-in account on application reload.
Apply authentication rate limits and security event logging.
`);
add('App lock and two-step PIN','Signed-in account; account lock is distinct from a chat lock','client/src/components/LockScreen.jsx|client/src/components/PinResetForm.jsx|server/controllers/authController.js',`
Enable a two-step application-lock PIN.
Store the PIN as a password hash rather than readable text.
Show an application lock screen when PIN verification is required.
Verify the PIN to unlock the application.
Change an existing PIN.
Disable the PIN after the required verification.
Request an email code for forgotten-PIN recovery.
Reset the PIN using a valid recovery code.
Expire recovery codes and restrict incorrect recovery attempts.
Keep PIN and PIN-recovery secrets out of user API responses.
Use the same account PIN for access to the locked-chat list.
`);
add('Sessions and signed-in devices','Signed-in account; own sessions only','server/utils/session.js|server/controllers/authController.js|client/src/pages/SettingsPage.jsx',`
List tracked signed-in sessions and devices.
Show the device/browser label derived from its user agent.
Track session creation and recent activity.
Identify the current session in device management.
Revoke an individual session.
Revoke all other sessions while preserving the current one.
Reject tokens belonging to a revoked session.
Expire sessions after their absolute lifetime.
Expire sessions after the configured idle period.
Keep refresh token hashes instead of raw refresh tokens in storage.
Periodically update activity without writing on every request.
Recheck account status and token version on authenticated requests.
`);
add('Profile and account data','Signed-in account; another user receives privacy-filtered data','server/controllers/userController.js|client/src/components/modals/ModalHost.jsx|client/src/pages/SettingsPage.jsx',`
View your name, username, email, phone, avatar and about text.
Edit the display name.
Edit the username with uniqueness and format checks.
Edit the phone number with uniqueness validation.
Edit the about/bio text.
Change the profile photo.
Show fallback initials/avatar when a photo is absent or hidden.
Open another person's contact/profile information.
Export account data through the authenticated export endpoint.
Delete your own account using the account danger-zone flow.
Clean associated relationships and account-owned data during deletion.
Keep password hashes, OTPs, reset tokens and PIN secrets out of safe profiles.
`);
add('Contacts and contact requests','Signed-in users; consent-based mutual contacts','server/controllers/contactController.js|server/controllers/userController.js|client/src/pages/ContactsPage.jsx',`
Search for a person by exact email.
Search for a person by exact username.
Search for a person by normalized phone number.
Search partial names/usernames within the permitted team directory.
View the existing contacts list and contact count.
Search/filter your displayed contacts.
Send a contact request.
View incoming contact requests.
View outgoing contact requests.
Accept an incoming request.
Reject an incoming request.
Automatically accept crossed pending requests from both people.
Prevent duplicate pending requests.
Allow a fresh request after a previous request was rejected.
Update both contact lists when a request is accepted.
Remove a contact.
Add or remove a contact from favorites.
Start a direct chat with a permitted mutual contact.
Start audio or video calls from contact actions.
Update requests and accepted contacts through realtime events.
Restrict exposure of another person's email and phone to permitted contacts.
`);
add('QR codes and invite links','Signed-in users; browser camera permissions for scanning','client/src/components/InviteQrModal.jsx|client/src/components/ScanQrModal.jsx|client/src/components/QrScanner.jsx|client/src/lib/invite.js|client/src/pages/JoinInvite.jsx',`
Display your contact QR code.
Share or copy the associated contact link.
Display a group invite link and QR code.
Display a workspace invite link and QR code where permitted.
Scan supported invitation QR codes with a camera.
Paste an invitation link manually when camera scanning is unavailable.
Switch available scan cameras where the scanner exposes the option.
Stop scanning and release the camera when the scanner closes.
Handle denied camera permission and unreadable QR data.
Parse supported contact, group and workspace invite formats.
Open a scanned or pasted invitation through the matching join flow.
Preserve invitation context through sign-in or signup.
Reject unsupported or malformed invite links.
`);
add('Chat list and conversation organization','Signed-in users; list is personal to the account','client/src/components/chat/ChatSidebar.jsx|server/controllers/chatController.js|server/controllers/userController.js',`
List direct conversations and group conversations.
Show each conversation's name and avatar.
Show last-message preview and last activity time.
Show unread-message counts and unread badges.
Show sent/delivered/read state in conversation previews.
Show typing and presence hints where available.
Filter All conversations.
Filter only Unread conversations.
Filter only Groups.
Filter Archived conversations.
Search the chat list.
Open the new-chat contact picker.
Create or reuse a direct chat with the same contact.
Pin or unpin a chat in your own list.
Archive or unarchive a chat.
Mute or unmute a chat.
View the archived/filtered conversation views exposed by the sidebar.
Open broadcast lists from the chat navigation.
Select a conversation and show its header, history and composer.
Refresh chat ordering and previews after incoming messages.
Keep per-user pin/archive/mute settings separate from other participants.
`);
add('Locked chats, clearing and disappearing messages','Chat members; PIN needed for locked-chat access','server/controllers/chatController.js|client/src/components/chat/ChatHeader.jsx|client/src/components/chat/RightPanel.jsx',`
Lock a selected chat using the account PIN flow.
Hide locked chats from the ordinary conversation list.
Reveal the locked-chat list after PIN verification.
Unlock a previously locked chat.
Exclude locked conversations from global search.
Clear message history for yourself.
Remove a direct conversation from your personal view.
Leave a group through the group chat removal flow.
Reject chat removal by a nonparticipant before any write.
Enable disappearing messages for a chat.
Choose disappearing-message periods of 24 hours, 7 days or 90 days.
Turn disappearing messages off.
Apply expiry timestamps to messages sent while disappearance is enabled.
Keep personal deletions from reappearing through search/context lookup.
`);
add('Message composer and everyday sending','Chat members with posting permission','client/src/components/chat/MessageComposer.jsx|client/src/store/useChat.js|server/controllers/messageController.js',`
Write and send a text message.
Use multi-line message input.
Send with Enter when Enter-to-send is enabled.
Use a separate newline gesture instead of sending.
Open and close the emoji picker.
Insert an emoji into the current message.
Open the attachment/action picker.
Retain separate unsent drafts for different conversations.
Restore a saved draft after returning to a conversation.
Continue safely if browser storage is unavailable.
Show an optimistic outgoing message while the request is pending.
Replace the temporary message with the saved server message.
Show failed-send status when sending fails.
Show the reply target above the composer.
Cancel the current reply before sending.
Prevent empty text-only messages.
Validate message text length; server limit is 10,000 characters.
Use team quick replies from the composer when available.
Send attachment descriptors together with the message.
Apply direct-chat blocking/contact gates before delivery.
`);
add('Message history and reading experience','Conversation participants','client/src/components/chat/MessageList.jsx|client/src/components/chat/MessageBubble.jsx|server/controllers/messageController.js',`
Load the newest page of message history.
Scroll back to load older history pages.
Use timestamp plus message ID for stable pagination.
Avoid duplicate messages when pages and realtime updates overlap.
Show date separators and message timestamps.
Distinguish your outgoing messages from received messages.
Render text, image, video, document and recorded-message bubbles.
Render location, live-location and poll messages.
Show sender identity in a group conversation.
Show system messages for group actions.
Show quoted reply context.
Jump to a quoted or searched message with a context window.
Return to the latest messages after viewing older context.
Keep newer incoming messages when a local delete request fails.
Show loading, empty-history and unavailable-message states.
Prevent outsiders from reading private conversation history.
`);
add('Message actions, reactions and forwarding','Conversation participants; edits/retraction restricted to sender','client/src/components/chat/MessageBubble.jsx|client/src/components/modals/ModalHost.jsx|server/controllers/messageController.js',`
Reply to a selected message.
Reject replies to deleted or inaccessible targets.
Copy supported message text to the clipboard.
Edit your own eligible message.
Limit editing to the existing five-minute edit window.
Display edited-message state.
Delete a message for yourself.
Delete your own eligible message for everyone.
Limit delete-for-everyone to the existing five-minute window.
Show a removed-message placeholder after retraction.
Add an emoji reaction to a message.
Change or remove your reaction through the reaction action.
Display reaction counts and updates.
Forward a message to selected chats.
Search destination chats in the forward picker.
Preserve forwarded attribution metadata.
Forward supported attachments, including verified video notes.
Reject edits or retractions attempted by another sender.
Create a team task from an accessible team message.
`);
add('Starred messages','Signed-in users; stars belong to the individual user','client/src/pages/StarredPage.jsx|server/controllers/messageController.js',`
Star a message from its action menu.
Unstar a previously starred message.
Open the dedicated Starred page.
List starred messages across accessible conversations.
Show source conversation and sender context.
Open a starred message in its conversation.
Remove a star directly from the starred list.
Keep stars separate from chat-wide temporary pins.
Respect membership and personal-deletion visibility.
Show an empty state when no starred messages are available.
`);
add('Temporary pinned messages','Direct-chat participants; group owners/admins can pin','server/utils/pins.js|client/src/components/chat/PinnedBanner.jsx|server/controllers/messageController.js',`
Pin an eligible message for all conversation participants.
Choose a pin lifetime of 1 hour.
Choose a pin lifetime of 6 hours.
Choose a pin lifetime of 12 hours.
Choose a pin lifetime of 24 hours.
Display active pins in the conversation banner.
Open or jump to a pinned message.
Change/extend an existing pin through the pin operation.
Unpin a message when permitted.
Keep a maximum of three active pins per conversation.
Evict the oldest pin when a new pin exceeds the cap.
Expire pins after their chosen duration.
Restrict group pin actions to the permitted group roles.
Update pins through realtime events.
Load active pins with the first message-history page.
`);
add('Typing, presence and delivery receipts','Privacy and tenant capabilities apply','server/socket/index.js|client/src/hooks/useSocket.js|client/src/lib/chatReadReceipts.js|server/utils/presence.js',`
Show another participant typing in an open chat.
Stop the typing indicator when typing ends.
Show online/offline presence where permitted.
Show last-seen information where permitted.
Track presence across multiple sockets/devices.
Send periodic presence pings.
Show a single tick for sent messages.
Show delivered acknowledgement state.
Show read acknowledgement state.
Mark a conversation read when the recipient opens/reads it.
Update unread counts after read acknowledgements.
Honor read-receipt privacy on sending and displaying read states.
Deduplicate repeated client read receipts for the same message.
Reset receipt deduplication appropriately after reconnect.
Require membership before joining private chat socket rooms.
Refresh conversation state after realtime changes and reconnects.
`);
add('Photos, videos, documents and upload limits','Members with attachment access; local or configured Cloudinary storage','server/middleware/upload.js|server/controllers/uploadController.js|server/utils/uploadMetadata.js|client/src/lib/api.js',`
Select and send images from the photo picker.
Send ordinary video files through the supported upload flow.
Send supported documents and file attachments.
Upload multiple files in one request, up to 10 files.
Limit each image to 10 MB.
Limit each ordinary video or file to 50 MB.
Limit video notes to 10 MB.
Validate file extension/type against the upload allow-list.
Support JPEG, JPG, PNG, GIF and WebP image extensions.
Support MP4, WebM and MOV video extensions.
Support MP3, WAV, OGG and M4A audio extensions.
Support PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, ZIP and TXT files.
Show readable errors for unsupported types, too many files and oversized uploads.
Check stricter image limits after multipart processing.
Clean up rejected local image uploads.
Return attachment URL, name, size and MIME metadata.
Store uploaded bytes on local disk or the configured cloud driver.
Issue a short-lived access token for protected local media URLs.
Verify actual local video-note bytes at message send and schedule time.
Verify signed cloud upload size metadata without additional database reads.
Verify legacy owned cloud clips through the configured provider when needed.
Preserve upload proofs through message forwarding and scheduling.
Keep unverified external video-note URLs from bypassing the upload limit.
`);
add('Camera, voice notes and round video notes','Browser device permission and recording support required','client/src/components/chat/MessageComposer.jsx|client/src/components/chat/MessageBubble.jsx',`
Open the in-chat camera capture interface.
Preview the live camera image before capture.
Switch front/back cameras when supported by the device.
Capture a photo and send it to the conversation.
Close camera capture and release the media stream.
Record an audio voice note using the microphone.
Show elapsed voice recording time.
Send the recorded voice note.
Cancel and discard a voice recording.
Record a round video note from the composer.
Show video-note recording time and preview.
Stop video-note recording at 60 seconds.
Send or discard the video-note recording.
Reject a video note larger than 10 MB before upload.
Use the dedicated stricter video-note upload endpoint option.
Render video notes with a distinct circular presentation.
Play received voice/audio and video messages with supported browser controls.
Show permission/device-unavailable errors when capture cannot start.
Release camera/microphone tracks when the capture UI closes.
`);
add('View-once media','Image/video message participants','server/controllers/messageController.js|client/src/components/chat/MessageComposer.jsx|client/src/components/chat/MessageBubble.jsx',`
Mark an eligible image/video message as view-once.
Show the view-once state instead of an ordinary media preview.
Open view-once media through the viewed operation.
Record which recipient opened the item.
Remove consumed media attachment data from the message after viewing.
Prevent normal repeat opening once the item is consumed.
Keep view-once behavior separate from disappearing-message timers.
Restrict the view-once flag to supported image/video message types.
`);
add('Chat polls','Members who may post in the conversation','client/src/components/chat/PollCard.jsx|client/src/components/chat/MessageComposer.jsx|server/controllers/messageController.js',`
Open the Create poll composer.
Enter a poll question.
Add and edit answer options.
Remove an answer option before sending.
Choose single-answer or multiple-answer voting.
Send the poll as a conversation message.
Vote for a permitted choice or choices.
Update an existing vote through the poll vote flow.
Show vote totals and option result bars.
Update poll votes through realtime events.
Validate option indexes and poll contents on the server.
Apply membership, group posting and direct-chat blocking rules.
`);
add('Scheduled messages','Conversation members; dispatcher runs on the server','client/src/components/chat/MessageComposer.jsx|server/controllers/messageController.js|server/utils/scheduledDispatcher.js',`
Open the Schedule message dialog.
Write the text to send later.
Select a custom date and time.
Choose the one-hour scheduling shortcut.
Choose the three-hour scheduling shortcut.
Choose tonight at 8 PM when that time is still available.
Choose tomorrow at 9 AM.
Create a scheduled text/media message through the API.
Require at least 10 seconds of scheduling lead time.
Limit one sender to 50 pending scheduled messages per chat.
List your own pending/failed scheduled items in a conversation.
Cancel your own scheduled message.
Send automatically even when the sender's browser is offline.
Dispatch through the normal delivery and authorization flow.
Recheck reply visibility and video-note upload size.
Track pending, sent, cancelled or failed delivery state.
Link a successful scheduled row to the delivered message.
Notify the author's other devices when schedule state changes.
`);
add('Location and live location','Browser location permission; conversation membership','client/src/components/chat/MessageComposer.jsx|server/controllers/liveLocationController.js',`
Share your current static geographic location.
Attach latitude, longitude and a location label to a message.
Render the location as a dedicated message card.
Start a live-location sharing session.
Choose the available live-location sharing duration.
Update the active location while browser tracking is running.
View active live-location shares for the conversation.
Receive live location updates in realtime.
Stop an active share manually.
Expire a live share after its selected lifetime.
Restrict location updates/stopping to the share owner.
Handle denied or unavailable browser geolocation.
`);
add('Groups, group members and group roles','Workspace/contact restrictions and group roles apply','server/controllers/groupController.js|client/src/pages/GroupsPage.jsx|client/src/components/chat/RightPanel.jsx|server/utils/rbac.js',`
Create a group with a name and selected members.
Add an optional group description.
View your group list and member counts.
Open a group conversation from the group list.
Edit the group name, description or avatar when permitted.
View group participants and their role labels.
Add eligible contacts/team members to the group.
Search contacts in the Add members picker.
Remove a group member when permitted.
Promote an eligible member to group admin.
Dismiss a group admin back to member when permitted.
Represent group owner, admin and member roles separately.
Restrict role changes/removal according to group permissions.
Set the group posting policy to all members or admins only.
Enforce the posting policy for normal and scheduled messages.
Share a group invitation link/QR code.
Join a group using its invitation code.
Honor the user's group-add permission setting.
Leave a group.
Handle owner departure with the group ownership rules.
Show group membership changes as system messages.
Start a group audio/video call from the conversation.
`);
add('Communities and announcement groups','Signed-in users; community membership/role rules apply','server/controllers/communityController.js|client/src/pages/CommunitiesPage.jsx',`
Create a named community.
Add a community description.
Create the associated announcements group.
List communities available to the signed-in user.
Open community details and linked groups.
Join a community with its invite code.
Add an eligible existing group to a community.
Restrict group linking to permitted community administrators.
Use announcement-group posting restrictions.
Navigate from a community to its group chats.
Leave a community.
Apply community membership and access checks to detail operations.
`);
add('Broadcast lists','Mutual contacts only; owner manages the list','server/controllers/broadcastController.js|client/src/pages/BroadcastsPage.jsx',`
Create a named broadcast list.
Select recipients from eligible mutual contacts.
Deduplicate recipient IDs and exclude the sender.
Support up to 256 recipients per list.
View your own broadcast lists and recipient counts.
Rename a broadcast list.
Edit its recipient list.
Delete your own broadcast list.
Send text through a broadcast list.
Send supported image/video/document broadcast attachments.
Deliver individually into each recipient's direct conversation.
Create a direct conversation for an eligible recipient when needed.
Recheck mutual contacts at send time.
Skip recipients blocked by the sender.
Skip recipients who have blocked the sender.
Return separate sent and skipped counts.
Emit incoming message/conversation updates to recipients.
Refresh affected chat-list caches after broadcast delivery.
`);
add('Search and jump to message','Only permitted content; locked chats excluded globally','client/src/components/search/GlobalSearch.jsx|client/src/components/chat/ChatSearchResults.jsx|server/controllers/searchController.js|server/controllers/messageController.js',`
Open the global search interface from application navigation.
Search people, chats, messages and meetings together.
Group global search results by content type.
Debounce search input rather than request on every keystroke.
Require a useful minimum query length for global search.
Search permitted people by exact identifiers.
Search existing group chat names.
Search direct conversations associated with matching people.
Search message text only inside accessible chats.
Search meeting titles only among hosted/invited meetings.
Search within the currently open conversation.
Select a result and load its surrounding message context.
Highlight or focus the selected message in history.
Exclude locked chats from global search results.
Exclude personally deleted/unavailable messages from context lookup.
Cap result counts so responses remain bounded.
Escape user regex input and use indexed text search where available.
`);
add('Status and 24-hour stories','Contacts and per-story audience rules apply','client/src/pages/StatusPage.jsx|server/controllers/statusController.js|server/models/Status.js',`
Create a text status update.
Choose the text-status background.
Create supported image/video status updates.
Attach a caption/content field where supported.
Show your own active status items.
Show contacts' status items grouped by person.
Open a full-screen status viewer.
Move between story items and people.
Automatically advance stories with the progress timer.
Hold/pause a story while viewing or typing a reply.
Use left/right keyboard arrows to navigate stories.
Close the story viewer with Escape.
Show story progress and seen/unseen state.
Expire status items after 24 hours.
Mark an allowed status as viewed.
Avoid counting the owner as their own viewer.
Avoid counting repeated views by the same viewer.
Show status viewers and view times to the owner.
Update owner view counts in realtime.
Reply to an allowed status.
Delete your own status update.
Limit story audience to contacts even for the broad audience option.
Support selected-contact and excluded-contact audiences through the API.
Keep viewer lists/reply-author data private from other viewers.
Refresh allowed contacts' feeds when a status is posted or deleted.
`);
add('Direct and group audio/video calls','Browser media permission; contact/group and tenant feature gates','server/controllers/callController.js|server/utils/callService.js|client/src/hooks/useWebRTC.js|client/src/components/overlays/CallOverlay.jsx',`
Start a direct audio call.
Start a direct video call.
Start a group audio call.
Start a group video call.
Show outgoing dialing/ringing state.
Show an incoming-call overlay with caller identity.
Accept an incoming call.
Reject an incoming call.
Cancel an outgoing call before connection.
End an active call.
Handle busy or already-in-call state.
Handle unanswered/missed calls.
Show call duration and connection state.
Mute or unmute your microphone.
Turn the camera off or on.
Share your screen when browser support allows it.
Restore the camera after screen sharing stops.
Toggle browser microphone noise cancellation.
Switch audio output/speaker where browser setSinkId support exists.
Show local self-preview and remote participant video tiles.
Minimize a call while continuing to use the application.
Restore/expand the minimized call.
Use mute/end controls from the minimized call bar.
Enter or exit full-screen call view.
Use responsive group-call tile layouts.
Switch between the available grid/stage call views.
Choose portrait or landscape video tile shape.
Open Add people and invite eligible contacts into the active call.
Introduce invited conference members to the existing call peers.
Close ringing overlays on your other devices after you handle a call.
Exchange offer/answer/ICE through authorized Socket.IO signaling.
Clean up media tracks and connections on hangup/disconnect.
`);
add('Call history and network relay support','Signed-in users; real relay operation requires provider configuration','client/src/pages/CallsPage.jsx|server/controllers/rtpccred.js|server/utils/iceServers.js|client/src/lib/iceServers.js',`
List recent call records.
Show audio/video type, peer, time and duration.
Distinguish incoming, outgoing and missed call history.
Filter the call-history screen using its available call categories.
Call a person back from history.
Load authenticated ICE configuration before establishing media.
Use STUN to discover direct network connectivity.
Use configured self-hosted coturn relays first.
Use configured Metered relays as an additional provider.
Use configured Cloudflare relays as an additional provider.
Preserve server-side provider preference order.
Mint time-limited TURN credentials on the server.
Refresh credentials before the server-reported TTL expires.
Share one in-flight credential request across concurrent callers.
Return controlled STUN-only state when no relay is configured.
Show a useful relay/network explanation when connection fails.
Keep provider keys and relay shared secrets out of the frontend.
`);
add('Meeting scheduling and invitations','Signed-in users; host controls edits and invitations','client/src/components/modals/ModalHost.jsx|client/src/pages/MeetingsPage.jsx|server/controllers/meetingController.js|server/utils/meetingReminders.js',`
Schedule a meeting with a title.
Store an optional meeting description.
Choose meeting date and start time.
Store meeting timezone and planned duration.
Choose audio or video meeting type.
Invite selected eligible users/contacts.
Invite additional people by email.
Associate a meeting with a chat through the API.
Generate a unique readable room code and shareable join link.
Copy the meeting ID or join link.
Invite additional people to an existing meeting as host.
RSVP Going, Maybe or Can't go.
Track pending RSVP responses.
View upcoming, past or all meetings.
Show meeting host, time, type and invitation state.
Edit permitted meeting details as host.
Cancel a meeting as host.
Send invitation/update notifications and configured email invitations.
Schedule a pre-meeting reminder using reminderMinutes.
Save the recurrence choice: none, daily, weekly or monthly.
Recurrence is stored only; automatic future occurrence generation is not implemented.
Retain scheduled, ongoing, completed and cancelled meeting states.
`);
add('Meeting join, password and device check','Signed-in attendee; host/admission policies apply','client/src/components/meeting/DeviceCheck.jsx|client/src/pages/MeetingRoom.jsx|server/controllers/meetingController.js|server/socket/index.js',`
Join a meeting by code.
Join by a shareable meeting URL.
Open the meeting details before joining.
Preview the camera before entering the room.
Choose an available microphone.
Choose an available camera.
Test microphone input with the pre-join level indicator.
Play a speaker test tone.
Enable or disable pre-join noise suppression.
Report denied permissions or missing media devices.
Allow joining without a working device when the browser/client permits it.
Protect a meeting with an optional password.
Validate the password before issuing meeting access.
Wait for the host when join-anytime is disabled.
Knock/request admission for uninvited link joins when Ask to join is enabled.
Show pending admission and denied-entry states.
Let the host admit or deny a waiting participant.
Use a scoped, short-lived admission pass for the admitted attendee.
Apply mute-on-entry to non-host participants.
Reject cancelled, invalid, locked or unauthorized breakout rooms.
`);
add('Live meeting room and media controls','Admitted participants; browser and transport support apply','client/src/pages/MeetingRoom.jsx|client/src/hooks/useMeetingRoom.js|client/src/hooks/useLiveKitRoom.js',`
Show the meeting title, room ID and participant count.
Show your self-preview and remote participant tiles.
Mute or unmute your microphone.
Turn your camera on or off in video meetings.
Share a screen/window/tab where browser capture is supported.
Stop presenting and restore the camera stream.
Show a presenting banner and dedicated presenter stage.
Keep other participants in a strip while someone presents.
Switch video tile shape between portrait and landscape.
Enter or exit full-screen meeting mode.
Show connection/network quality.
Show media-permission and stream errors.
Warn when a peer-to-peer room exceeds comfortable capacity.
Use peer-to-peer mesh by default.
Use LiveKit SFU transport when configured on the server.
Adapt mesh encoding to the number of peer connections.
Record the meeting locally on the participant's device where supported.
Stop local recording and save/download the resulting local recording.
Auto-start local recording when the meeting's Auto-record option is enabled.
Show an active recording indicator.
Keep secondary controls in a mobile More options sheet.
Leave the room and clean up media/network resources.
`);
add('Meeting chat, reactions, hands, polls and Q&A','Admitted participants; selected actions are host-only','client/src/components/meeting/MeetingPollsPanel.jsx|client/src/pages/MeetingRoom.jsx|server/socket/index.js',`
Open or close the in-meeting chat drawer.
Send a text message to the live meeting room.
Show sender identity on meeting chat messages.
Show an unread meeting-chat badge while the drawer is closed.
Send a meeting emoji reaction.
Show live floating reactions.
Retain a bounded reaction history on the meeting.
Raise your hand.
Lower your own hand.
Show the queue of raised hands in order.
Allow the host to lower another participant's hand.
Create an in-meeting poll with question and answer options as permitted.
Support single-choice or multiple-choice meeting polls.
Vote and replace an existing vote.
Show live poll results.
Close a poll as host/permitted creator according to server rules.
Ask a Q&A question.
Ask anonymously through the supported Q&A option.
Upvote a question with per-user vote tracking.
Mark a question answered and attach an answer as host.
Persist meeting polls/questions separately from ordinary chat polls.
Restrict collaboration events to participants in the live room.
`);
add('Host controls, breakouts, notes and attendance','Host-only moderation/reporting; participants can use permitted notes','server/controllers/meetingController.js|server/socket/index.js|client/src/components/meeting/MeetingNotesPanel.jsx|client/src/pages/MeetingRoom.jsx',`
Lock or unlock a live meeting to additional entry.
Enable or disable participant meeting chat.
Enable or disable participant screen sharing.
Mute all participants as host.
Force-mute a selected participant.
Remove a participant from the live meeting.
Create 2 to 4 breakout rooms as host.
Assign meeting participants into breakout rooms.
Send breakout invitation events to assigned participants.
List current breakout rooms.
Open an assigned breakout room.
Return from a breakout room to the main meeting.
End current breakout rooms as host.
Reject unassigned users and nested breakout creation.
Open shared meeting notes.
Edit and save shared notes up to 20,000 characters.
Reload notes changed by another participant.
Use version/timestamp conflict detection rather than overwrite another edit.
Create a team task from accessible meeting notes.
Record the first actual room start and final end time.
Track attendee first-join, last-leave and accumulated attendance duration.
Retain attendance across a participant's rejoins.
View the attendance report as host.
Show meeting time, duration, attendee count and attendee records in the report.
`);
add('Notifications, sounds and Web Push','Signed-in account; OS push needs browser permission and VAPID setup','client/src/components/layout/TopBar.jsx|server/controllers/notificationController.js|server/controllers/pushController.js|server/utils/push.js|client/public/sw.js',`
Open the in-app notification bell/list.
Show unread notification counts.
Mark one notification read.
Mark all notifications read.
Open the related chat, contact request, call or meeting from a notification.
Receive contact request and acceptance notifications.
Receive direct/group message notifications.
Receive call and meeting notifications.
Save in-app notifications independently of OS-push preferences.
Enable or disable message notifications.
Enable or disable group notifications.
Enable or disable call notifications.
Enable or disable meeting notifications.
Enable or disable notification sound.
Request browser desktop/push notification permission.
Subscribe the current browser to Web Push.
Unsubscribe a browser push endpoint.
Expose the public VAPID key through authenticated API access.
Handle a service-worker push and its notification click.
Focus/open the relevant application page from a push.
Respect muted chats, notification preferences and Do not disturb for push.
Remove expired push subscriptions after provider expiry responses.
`);
add('Privacy, blocking and reporting','Own privacy settings; API enforcement varies by field','client/src/pages/SettingsPage.jsx|server/utils/privacy.js|server/controllers/userController.js|server/controllers/reportController.js',`
Choose last-seen visibility: Everyone, My contacts or Nobody.
Choose online-status visibility: Everyone, My contacts or Nobody.
Choose profile-photo visibility: Everyone, My contacts or Nobody.
Choose About visibility: Everyone, My contacts or Nobody.
Enable or disable reciprocal read receipts.
Choose who may add you to groups: Everyone or Contacts.
Store the account's status audience preference.
Store settings in the account rather than only local component state.
Block or unblock a person.
Exclude blocked people from applicable discovery results.
Reject contact requests blocked in either direction.
Reject direct message delivery blocked in either direction.
Skip blocked broadcast recipients.
Restrict direct call/contact signaling through the applicable server gates.
Report a user.
Report a group.
Submit message/status target reports through the report API.
Provide report reason and optional description.
Keep report submission confidential from the reported party.
Enforce conversation, workspace and tenant membership checks on private data.
`);
add('Presence preferences and appearance','Signed-in users; personal appearance does not restyle another user','client/src/pages/SettingsPage.jsx|client/src/lib/wallpapers.js|server/controllers/userController.js|client/src/components/chat/RightPanel.jsx',`
Set manual presence to Available.
Set manual presence to Away.
Set manual presence to Busy.
Set manual presence to Do not disturb.
Suppress push/desktop interruptions in Do not disturb while retaining the bell.
Choose Light theme.
Choose Dark theme.
Follow the System theme.
Choose Teal, Indigo, Violet, Cyan, Emerald, Rose or Amber accents.
Set a default chat wallpaper for the account.
Override the wallpaper for one conversation.
Reset a conversation to the default wallpaper.
Use Default, Mint, Paper, Ink, Aurora, Dusk or Ocean presets.
Use Dots, Grid, Waves or Doodle wallpaper patterns.
Apply each wallpaper's light/dark variant.
Store a per-chat bubble-accent override through the theme API.
Enable or disable Enter-to-send.
Keep personal chat themes synchronized through saved account settings.
`);
add('Workspace setup, members and roles','Team owner/admin/member; platform admin has separate authority','server/controllers/workspaceController.js|client/src/pages/SettingsPage.jsx|server/utils/rbac.js|server/utils/workspaceService.js',`
Create a team workspace through the explicit team signup path.
Place individual accounts in the shared Personal space.
View workspace identity, type and your current workspace role.
View the team member roster.
Rename/edit allowed workspace settings as owner/admin.
Copy/share a workspace invite code or link.
Rotate the workspace invite code as owner/admin.
Join invited users as team members.
Promote eligible team members to workspace admin.
Demote an eligible admin to member.
Suspend an eligible workspace member.
Reactivate an eligible suspended member.
Remove an eligible member from the workspace.
Transfer workspace ownership to an eligible member as owner.
Change the previous owner's role according to the transfer flow.
Protect owner/self operations from invalid role/status changes.
Separate workspace permissions from group permissions.
Keep cross-workspace direct chats separate from team-owned group data.
Restrict team tools from Personal accounts and limited guests.
`);
add('Shared customer inbox','Customer initiates a thread; team members handle team replies','server/controllers/workspaceToolsController.js|client/src/pages/WorkspacePage.jsx|client/src/pages/TeamContactPage.jsx',`
Open a team's customer-contact screen.
Start a customer thread explicitly, without copying private direct messages.
Post further customer messages into the existing team thread.
List the customer's own team inbox conversations.
List incoming customer threads for the team.
Filter team inbox threads by open, pending or closed status.
Open a thread with its customer and message history.
Reply to a customer as a team member.
Assign a thread to an active teammate.
Clear the assignee to leave a thread unassigned.
Change thread status to Open, Pending or Closed.
Reopen a thread when the customer follows up.
Add a team-only internal note.
Show note author information to permitted team staff.
Remove internal notes from customer GET and follow-up responses.
Keep duplicate-create retry responses customer-safe.
Broadcast inbox-update hints to the team and customer in realtime.
Prevent another workspace from opening the team's threads.
Cap thread/message/note content to bound stored history.
`);
add('Team tasks and workspace activity','Active non-guest team members; activity is owner/admin-only','server/controllers/workspaceToolsController.js|server/utils/workspaceTaskReminders.js|client/src/pages/WorkspacePage.jsx',`
Create a manual team task.
Enter task title and optional description.
Assign a task to an active teammate.
Leave a task unassigned.
Set a future due date/time.
Create a task from an accessible team-chat message.
Create a task from accessible meeting notes.
Retain the task's source type and source ID.
List team tasks with assignee and creator context.
Mark a task Done.
Reopen a completed task.
Edit task title or description through the API.
Change or clear the assignee.
Change or clear the due date.
Reset reminder state when the due date changes.
Send due-task reminders through the task reminder worker.
Receive task-update hints in realtime.
Validate source message/meeting access before linking the task.
View workspace activity events as owner/admin.
Show activity actor, action, target and time.
Log supported member, inbox, task and guest actions.
Reject activity reads by ordinary members and foreign workspaces.
`);
add('Limited guests and guest portal','Workspace owner/admin invites; guest sees only selected groups','server/controllers/workspaceToolsController.js|server/utils/workspaceGuestExpiry.js|server/middleware/auth.js|client/src/pages/GuestPortal.jsx',`
Select 1 to 20 team groups for a guest invitation.
Generate a single-use guest signup link.
Keep the signup invitation valid for seven days.
Choose guest access for 1, 7, 30 or 90 days in the UI.
Choose access until revoked.
Accept 1 to 90 days or no expiry through the invite API.
Store the invitation token as a hash.
Register the guest into the invited team and permitted groups.
Open a dedicated restricted Guest groups portal.
Switch between the groups shared with that guest.
Read permitted group text history in the guest portal.
Send text-only replies to permitted groups.
Prevent guest file uploads and non-text posting.
Hide restricted attachments from the guest portal presentation.
Show guest access-expiry information.
List team guests and their active/suspended state as manager.
Revoke guest access immediately as owner/admin.
Remove the revoked guest from shared group memberships.
Invalidate revoked guest tokens.
Expire guest access through the guest-expiry worker.
Allow the guest to log out.
`);
add('Business storefront and automatic replies','Team business tools; owner/admin manages configuration','client/src/pages/BusinessPage.jsx|server/controllers/workspaceController.js|server/utils/autoReply.js',`
Open the team Business tools screen.
Set the business category.
Set the business description.
Set displayed business hours.
Set the business address.
Set the website link.
Set the business contact email.
Display the stored verified-business badge when granted.
Restrict business profile edits to permitted team roles.
Enable or disable the automatic greeting.
Edit the greeting message text.
Send the greeting once for the customer's first eligible conversation message.
Enable or disable the away reply.
Edit the away message text.
Set away business start and end hours.
Send an away response outside the configured business-hours window.
Throttle repeated away replies with the existing cooldown.
Run auto-reply checks off the normal message request path.
Avoid repeated configuration reads using the auto-reply cache.
`);
add('Product catalog and product sharing','Team business owners/admins manage products; permitted users browse/share','server/controllers/catalogController.js|client/src/pages/BusinessPage.jsx|client/src/components/chat/MessageComposer.jsx',`
View your team's product catalog.
Browse a business workspace's catalog through the API.
Create a product.
Set product name and description.
Set product price and currency.
Set product image information supported by the product form/API.
Set product URL information supported by the API.
Set product availability/inStock through the catalog API.
Edit an existing product.
Delete an existing product.
Prevent ordinary unauthorized members from editing the catalog.
Open the product picker from a team chat composer.
Select a product to share into a conversation.
Send the product's details through the product-share endpoint.
Apply normal conversation membership and send authorization to product sharing.
Show an empty catalog state when no products exist.
`);
add('Conversation labels and quick replies','Team workspace business tools','server/controllers/agentController.js|client/src/pages/BusinessPage.jsx|client/src/components/chat/RightPanel.jsx|client/src/components/chat/MessageComposer.jsx',`
List the team's conversation labels.
Create a label with a name and supported color.
Delete a label.
Apply a label to a permitted conversation.
Remove a label from a permitted conversation through its apply/toggle flow.
Fetch labels assigned to one conversation.
Show assigned labels in the conversation information panel.
Keep team labels scoped to the workspace.
List saved quick replies.
Create a quick reply with its shortcut and text.
Edit a quick reply.
Delete a quick reply.
Find/select quick replies from the composer integration.
Insert a saved response into the current message draft.
Keep quick-reply content reusable without sending it until the user sends.
`);
add('Platform apps and tenant administration','App owner or platform administrator','client/src/pages/PlatformPage.jsx|server/controllers/platformController.js|server/models/App.js',`
Create a named embedded platform app/tenant.
List apps owned by the caller; platform admins can see the broader app set.
Display and copy the app ID.
Display/copy a newly issued app secret in its permitted reveal flow.
Rotate the app secret.
Enable or disable an app.
Set permitted host-platform origins.
Validate allowed origins for embedding and token/bootstrap requests.
Configure the app seat limit.
Configure end-user token lifetime.
View app-specific statistics and usage counts.
Enable/disable Direct messaging, Groups, Voice calls or Video calls.
Enable/disable Meetings, Status or Presence.
Enable/disable Typing, Read receipts or Reactions.
Enable/disable Attachments, Voice notes or Web Push.
Enforce capability gates on the server for embedded tenants.
Isolate app users and tenant-owned messaging data.
Permanently delete an app through the explicit confirmation flow.
Require typing the app ID to confirm permanent deletion in the UI.
Remove the app's provisioned users/data through the deletion cleanup flow.
Show and respect deletion-in-progress state.
`);
add('Developer integration, hosted embed and SDKs','Host backend keeps app secret; browser receives user-scoped token','server/controllers/platformController.js|server/controllers/embedController.js|client/public/embed.js|packages/react/src/index.d.ts|packages/node/src/index.js|client/src/pages/DevelopersPage.jsx',`
Verify backend app credentials using the platform identity endpoint.
Provision a host-platform user using a stable external ID.
Upsert the same external user idempotently.
Update supported provisioned profile fields.
List provisioned users for the authenticated app.
Deactivate an external user through the app backend API.
Issue a short-lived token for one provisioned end user.
Use the Node SDK createUserSession helper to provision and mint a session.
Embed hosted ChatKonect without building a second chat UI.
Bootstrap public app configuration before user authentication.
Fetch authenticated embed session information.
Fetch authenticated embed ICE configuration.
Initialize the browser drop-in loader with app/host/user-token configuration.
Mount the React ChatKonect component in a host application.
Select initial navigation path.
Select Light, Dark or System embed theme.
Provide a token directly or through a getToken callback.
Renew the token based on its validated JWT expiry.
Change identityKey when the signed-in host user changes.
Navigate the embedded interface through its exposed handle.
Trigger a token refresh through the exposed handle.
Destroy/unmount the embedded interface cleanly.
Receive ready, error, configuration, logout and navigation callbacks.
Use React type definitions for component props and ref methods.
Validate postMessage sender/origin in the hosted integration bridge.
Use the supplied host-platform integration example as an implementation reference.
`);
add('API keys, public REST API and incoming webhooks','Platform admins manage API keys; webhook management checks group access','server/routes/v1Routes.js|server/controllers/apiKeyController.js|server/controllers/webhookController.js|client/src/pages/DevelopersPage.jsx',`
Create an API key with a name and supported scopes.
Reveal the newly created key through its creation response.
List owned API keys with safe metadata.
Revoke an API key.
Authenticate public API requests with X-API-Key.
Check key identity and granted scopes.
Read contacts and search users with contacts:read scope.
Read chats/history with chat:read scope.
Create direct chats and send messages with chat:write scope.
Initiate calls with calls:write scope.
Read meetings with meetings:read scope.
Create meetings with meetings:write scope.
Run public API operations as the key owner with normal data-access checks.
Apply public API rate limiting.
List owned/permitted incoming webhooks.
Create an incoming webhook for a permitted group.
Generate an unguessable webhook ingress URL.
Post a supported message into the target group using the ingress token.
Delete/revoke a webhook.
Rate-limit webhook ingress.
Keep app secrets, user tokens, API keys and webhook tokens as separate credentials.
`);
add('Admin dashboard, moderation and account control','Platform super-admin; separate from workspace admin','client/src/pages/AdminDashboard.jsx|server/controllers/adminController.js|server/utils/createAdmin.js|server/utils/deleteUserAccount.js',`
Open the platform administrator dashboard.
Show total users.
Show current active-user count.
Show total groups.
Show total messages.
Show total calls.
Show open report count.
Show the last seven days of user growth.
Show the last seven days of message volume.
List users with safe profile/account information.
Search users by name, username or email.
Set an eligible user's account to Active.
Suspend an eligible user.
Ban an eligible user.
Invalidate old tokens after suspension or banning.
Prevent an admin from suspending/banning themselves.
Delete another user and associated account data.
Prevent self-deletion through the admin delete endpoint.
List reports with reporter and target context.
Set report state to Open, Reviewing, Resolved or Dismissed.
Record security audit events for moderation changes.
Bootstrap/repair the configured super-admin account at startup.
`);
add('Application shell, responsive UI and installation assets','All users; native browser capabilities vary','client/src/App.jsx|client/src/components/layout/AppLayout.jsx|client/src/components/layout/NavRail.jsx|client/src/components/layout/MobileNav.jsx|client/src/components/ErrorBoundary.jsx|client/public/manifest.webmanifest',`
Navigate through the desktop rail and mobile bottom navigation.
Use a desktop conversation-list, message and information-panel layout.
Use mobile conversation navigation and back controls.
Open/close the conversation information panel.
Use responsive modals and mobile control sheets.
Show loading skeletons while data is being requested.
Show empty states when a module has no records.
Show success/error toasts for user actions.
Recover to an error boundary screen after an uncaught UI error.
Use accessible labels on icon-only controls and inputs.
Respect mobile safe-area spacing for bottom controls.
Retain theme-aware navigation, forms and message surfaces.
Expose a web app manifest and application icons for browser installation support.
Register the service worker used for notification handling.
Run the optional mock/demo mode to explore supported UI without live backend data.
Keep protected pages behind signed-in account access.
Route limited guests to their dedicated portal.
`);
add('Backend operation, data efficiency and safeguards','Deployment/operator capabilities; provider configuration may be required','server/server.js|server/utils/chatCache.js|server/utils/readCoalescer.js|server/utils/queue.js|server/utils/redis.js|server/routes/index.js',`
Expose a health endpoint with database, email readiness and build identity.
Report boot time and current service time.
Use authenticated HTTP and Socket.IO access gates.
Apply configured cross-origin and embedding-origin restrictions.
Validate identifiers and bounded message/upload inputs.
Use MongoDB indexes for common message/history and lookup paths.
Compute chat-list unread totals in a shared aggregation.
Use optional Redis caching for hot chat lists.
Invalidate chat-list caches when relevant data changes.
Coalesce identical concurrent chat-list reads without delaying later requests.
Separate locked/unlocked and per-user cache scopes.
Run notification/auto-reply jobs through the queue abstraction.
Use BullMQ/Redis when configured and the supported inline fallback otherwise.
Run the scheduled-message dispatcher.
Run meeting reminder checks.
Run task reminder checks.
Run guest-expiry checks.
Use multi-instance Socket.IO/Redis support when configured.
Limit auth, public API and webhook ingress traffic.
Keep secrets and private authentication fields out of client responses.
Keep local media access authorization separate from ordinary user sessions.
Use read-receipt deduplication and bounded result/page sizes to reduce repeat work.
`);

export const caveats = [
  'This catalogue describes features present in the local repository on 20 October 2026. It is not a claim that every feature has been exercised on real devices or deployed.',
  'Role and access notes describe the relevant module. Individual actions still require their server checks; a visible button is not a grant of permission.',
  'Meeting recurrence choices are saved, but future recurring instances are not automatically generated. Live captions/transcription and background replacement are not exposed as working features in the current meeting UI.',
  'Meeting recording is local browser/device recording, not a server recording archive. Device recording, screen capture, output switching and media quality depend on browser and device support.',
  'Video-note bytes are verified server-side. The local recorder stops at 60 seconds and declared durations above 60 seconds are rejected; local video is not independently decoded to measure actual duration.',
  'Profile-photo/About/status audience preferences exist. Visibility must be assessed at each consuming surface; saving a preference alone is not proof of universal privacy enforcement.',
  'Workspace free/pro/business plan values and app limits are product configuration. No payment gateway, checkout, subscription charging or full billing/invoicing module is implemented here.',
  'Email/OS push, Cloudinary, TURN and LiveKit require their respective deployment configuration. This PDF contains no private environment values, passwords or API secrets.',
];
