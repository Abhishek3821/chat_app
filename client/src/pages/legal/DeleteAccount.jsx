import { Link } from 'react-router-dom';
import LegalPage from './LegalPage';

export default function DeleteAccount() {
  return (
    <LegalPage title="Delete Your ChatKonect Account">
      <p>You can delete your ChatKonect account at any time. This page explains how to do it and what happens to your data.</p>

      <h2>How to Delete Your Account</h2>
      <ol>
        <li>Log in to your ChatKonect account.</li>
        <li>Go to <strong>Settings</strong>.</li>
        <li>Select <strong>Account</strong>.</li>
        <li>Choose <strong>Delete Account</strong>.</li>
        <li>Confirm your password or identity if asked.</li>
        <li>Confirm the deletion.</li>
      </ol>
      <p>Once you confirm, your account is closed and you are logged out.</p>

      <h2>What Gets Deleted</h2>
      <p>When you delete your account, we remove:</p>
      <ul>
        <li>Your profile information, such as your name, username, photo, and bio.</li>
        <li>Your email address and phone number.</li>
        <li>Your account settings and preferences.</li>
        <li>Your messages, files, and other content linked to your account.</li>
      </ul>

      <h2>What We May Keep</h2>
      <p>Some information may be kept for a limited time where it is needed for legal, security, or fraud prevention purposes. This can include basic account records and log data. Once there is no longer a reason to keep it, it is deleted or anonymized.</p>
      <p>Messages you sent to other users may still appear in their chats. We cannot remove copies that other people have saved on their own devices.</p>

      <h2>How Long It Takes</h2>
      <p>Your account is deactivated right away. Your data is permanently deleted within 30 days. Backup copies are removed on our normal backup cycle.</p>

      <h2>Before You Delete</h2>
      <ul>
        <li><strong>Deletion is permanent.</strong> You will not be able to recover your account, messages, or files.</li>
        <li><strong>Save what you need.</strong> Download any files or information you want to keep before you start.</li>
        <li><strong>You can sign up again.</strong> You are free to create a new account later, but it will not carry over any of your old data.</li>
      </ul>
      <p>For more on how we handle your information, please read our <Link to="/privacy-policy">Privacy Policy</Link>.</p>
    </LegalPage>
  );
}
