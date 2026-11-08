// Called only after Clerk has verified the session against the configured instance.
// A production identity can be explicitly mapped to an existing stable account.
// Never link care records from a browser-supplied email or public metadata.
export async function accountIdForSubject(db,subject) {
 if(typeof subject!=='string'||!/^user_[A-Za-z0-9]+$/.test(subject))throw new Error('Invalid verified Clerk subject');
 const alias=await db.prepare('SELECT account_id FROM account_identities WHERE subject=?').bind(subject).first();
 return alias?.account_id || `clerk:${subject}`;
}
