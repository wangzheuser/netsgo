import { useMemo, useState } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Fingerprint,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useTranslation } from 'react-i18next';
import { adminRoute } from '../admin';
import { useAdminSecurity, useAdminSecurityMutations } from '@/hooks/use-admin-security';
import {
  isPasskeySupported,
  normalizeCreationOptions,
  publicKeyCredentialToJSON,
} from '@/lib/webauthn';
import { useAuthStore } from '@/stores/auth-store';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type {
  PasskeyChallengeResponse,
  PasskeySummary,
  RecoveryCodesResponse,
  TOTPBeginResponse,
} from '@/types';

export const adminSecurityRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: '/security',
  component: AdminSecurityPage,
});

type CredentialForm = {
  currentPassword: string;
  mfaCode: string;
};

const emptyCredentialForm: CredentialForm = { currentPassword: '', mfaCode: '' };

function AdminSecurityPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useAuthStore((s) => s.logout);
  const { data, isLoading } = useAdminSecurity();
  const mutations = useAdminSecurityMutations();
  const [usernameForm, setUsernameForm] = useState({ ...emptyCredentialForm, newUsername: '' });
  const [passwordForm, setPasswordForm] = useState({ ...emptyCredentialForm, newPassword: '' });
  const [totpForm, setTotpForm] = useState(emptyCredentialForm);
  const [totpSetup, setTotpSetup] = useState<TOTPBeginResponse | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [passkeyForm, setPasskeyForm] = useState({ ...emptyCredentialForm, name: '' });
  const [renamePasskey, setRenamePasskey] = useState<PasskeySummary | null>(null);
  const [renameForm, setRenameForm] = useState({ ...emptyCredentialForm, name: '' });
  const [deletePasskey, setDeletePasskey] = useState<PasskeySummary | null>(null);
  const [deleteForm, setDeleteForm] = useState(emptyCredentialForm);
  const [securitySection, setSecuritySection] = useState('account');
  const [accountDialog, setAccountDialog] = useState<'username' | 'password' | null>(null);
  const [passkeyAddOpen, setPasskeyAddOpen] = useState(false);

  const passkeySupported = useMemo(() => isPasskeySupported(), []);

  const showSecurityError = (error: unknown) => {
    toast.error(error instanceof Error ? error.message : t('errors.generic'));
  };

  const forceRelogin = (message: string) => {
    toast.success(message);
    logout();
    void navigate({ to: '/login' });
  };

  const currentUser = data?.user;
  const requiresMFA = data?.totp_enabled ?? false;

  const handleUsernameSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const resp = await mutations.updateUsername.mutateAsync({
        current_password: usernameForm.currentPassword,
        mfa_code: usernameForm.mfaCode || undefined,
        new_username: usernameForm.newUsername,
      });
      if (resp.requires_relogin) {
        forceRelogin(t('admin.securityReloginRequired'));
        return;
      }
      setAccountDialog(null);
    } catch (error) {
      showSecurityError(error);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const resp = await mutations.updatePassword.mutateAsync({
        current_password: passwordForm.currentPassword,
        mfa_code: passwordForm.mfaCode || undefined,
        new_password: passwordForm.newPassword,
      });
      if (resp.requires_relogin) {
        forceRelogin(t('admin.securityReloginRequired'));
        return;
      }
      setAccountDialog(null);
    } catch (error) {
      showSecurityError(error);
    }
  };

  const beginTOTP = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const setup = await mutations.beginTOTP.mutateAsync({
        current_password: totpForm.currentPassword,
        mfa_code: totpForm.mfaCode || undefined,
      });
      setTotpSetup(setup);
    } catch (error) {
      showSecurityError(error);
    }
  };

  const confirmTOTP = async () => {
    if (!totpSetup) return;
    try {
      const resp = await mutations.confirmTOTP.mutateAsync({
        setup_token: totpSetup.setup_token,
        code: totpCode,
      });
      setRecoveryCodes(resp.recovery_codes);
      setTotpSetup(null);
      setTotpCode('');
    } catch (error) {
      showSecurityError(error);
    }
  };

  const disableTOTP = async () => {
    try {
      const resp = await mutations.disableTOTP.mutateAsync({
        current_password: totpForm.currentPassword,
        mfa_code: totpForm.mfaCode || undefined,
      });
      if (resp.requires_relogin) forceRelogin(t('admin.securityReloginRequired'));
    } catch (error) {
      showSecurityError(error);
    }
  };

  const regenerateRecoveryCodes = async () => {
    try {
      const resp: RecoveryCodesResponse = await mutations.regenerateRecoveryCodes.mutateAsync({
        current_password: totpForm.currentPassword,
        mfa_code: totpForm.mfaCode || undefined,
      });
      setRecoveryCodes(resp.recovery_codes);
    } catch (error) {
      showSecurityError(error);
    }
  };

  const addPasskey = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!passkeySupported) {
      toast.error(t('admin.passkeyUnsupported'));
      return;
    }
    try {
      const begin: PasskeyChallengeResponse = await mutations.beginPasskey.mutateAsync({
        current_password: passkeyForm.currentPassword,
        mfa_code: passkeyForm.mfaCode || undefined,
        name: passkeyForm.name,
      });
      const credential = await navigator.credentials.create({
        publicKey: normalizeCreationOptions(begin.public_key),
      });
      if (!(credential instanceof PublicKeyCredential)) {
        toast.error(t('admin.passkeyCreateFailed'));
        return;
      }
      const resp = await mutations.finishPasskey.mutateAsync({
        challenge_id: begin.challenge_id,
        credential: publicKeyCredentialToJSON(credential),
      });
      if (resp.requires_relogin) {
        forceRelogin(t('admin.securityReloginRequired'));
        return;
      }
      setPasskeyAddOpen(false);
      setPasskeyForm({ ...emptyCredentialForm, name: '' });
    } catch (error) {
      showSecurityError(error);
    }
  };

  const submitRenamePasskey = async () => {
    if (!renamePasskey) return;
    try {
      await mutations.renamePasskey.mutateAsync({
        id: renamePasskey.id,
        current_password: renameForm.currentPassword,
        mfa_code: renameForm.mfaCode || undefined,
        name: renameForm.name,
      });
      setRenamePasskey(null);
      setRenameForm({ ...emptyCredentialForm, name: '' });
      toast.success(t('admin.passkeyRenamed'));
    } catch (error) {
      showSecurityError(error);
    }
  };

  const submitDeletePasskey = async () => {
    if (!deletePasskey) return;
    try {
      const resp = await mutations.deletePasskey.mutateAsync({
        id: deletePasskey.id,
        current_password: deleteForm.currentPassword,
        mfa_code: deleteForm.mfaCode || undefined,
      });
      if (resp.requires_relogin) forceRelogin(t('admin.securityReloginRequired'));
    } catch (error) {
      showSecurityError(error);
    }
  };

  if (isLoading || !data || !currentUser) {
    return <SecuritySkeleton />;
  }

  return (
    <div className="pb-10">
      <Tabs value={securitySection} onValueChange={setSecuritySection} className="flex flex-col gap-5">
        <TabsList className="grid h-10 w-full grid-cols-3 rounded-lg bg-muted/40 p-1 sm:w-fit">
          <SecuritySectionTrigger value="account" icon={UserRound} title={t('admin.accountPasswordTab')} />
          <SecuritySectionTrigger value="totp" icon={ShieldCheck} title={t('admin.twoFactorAuth')} />
          <SecuritySectionTrigger value="passkey" icon={Fingerprint} title={t('admin.passkeys')} />
        </TabsList>

        <TabsContent value="account" className="mt-0">
          <AccountPasswordSection
            currentUser={currentUser}
            onEditUsername={() => {
              setUsernameForm({ ...emptyCredentialForm, newUsername: currentUser.username });
              setAccountDialog('username');
            }}
            onEditPassword={() => {
              setPasswordForm({ ...emptyCredentialForm, newPassword: '' });
              setAccountDialog('password');
            }}
          />
        </TabsContent>

        <TabsContent value="totp" className="mt-0">
          <TOTPSection
            enabled={data.totp_enabled}
            recoveryCodesRemaining={data.recovery_codes_remaining}
            form={totpForm}
            requiresMFA={requiresMFA}
            isBeginning={mutations.beginTOTP.isPending}
            isRegenerating={mutations.regenerateRecoveryCodes.isPending}
            isDisabling={mutations.disableTOTP.isPending}
            onFormChange={(patch) => setTotpForm({ ...totpForm, ...patch })}
            onBegin={beginTOTP}
            onRegenerate={regenerateRecoveryCodes}
            onDisable={disableTOTP}
          />
        </TabsContent>

        <TabsContent value="passkey" className="mt-0">
          <PasskeySection
            passkeys={data.passkeys}
            webauthn={data.webauthn}
            passkeySupported={passkeySupported}
            onAddRequest={() => {
              setPasskeyForm({ ...emptyCredentialForm, name: '' });
              setPasskeyAddOpen(true);
            }}
            onRename={(passkey) => {
              setRenamePasskey(passkey);
              setRenameForm({ ...emptyCredentialForm, name: passkey.name });
            }}
            onDelete={(passkey) => {
              setDeletePasskey(passkey);
              setDeleteForm(emptyCredentialForm);
            }}
          />
        </TabsContent>
      </Tabs>

      <UsernameDialog
        open={accountDialog === 'username'}
        form={usernameForm}
        requiresMFA={requiresMFA}
        isPending={mutations.updateUsername.isPending}
        onChange={(patch) => setUsernameForm({ ...usernameForm, ...patch })}
        onClose={() => setAccountDialog(null)}
        onSubmit={handleUsernameSubmit}
      />
      <PasswordDialog
        open={accountDialog === 'password'}
        form={passwordForm}
        requiresMFA={requiresMFA}
        isPending={mutations.updatePassword.isPending}
        onChange={(patch) => setPasswordForm({ ...passwordForm, ...patch })}
        onClose={() => setAccountDialog(null)}
        onSubmit={handlePasswordSubmit}
      />
      <TOTPSetupDialog setup={totpSetup} code={totpCode} onCodeChange={setTotpCode} onCancel={() => setTotpSetup(null)} onConfirm={confirmTOTP} />
      <RecoveryCodesDialog codes={recoveryCodes} onClose={() => {
        setRecoveryCodes([]);
        forceRelogin(t('admin.securityReloginRequired'));
      }} />
      <PasskeyAddDialog
        open={passkeyAddOpen}
        form={passkeyForm}
        requiresMFA={requiresMFA}
        passkeySupported={passkeySupported}
        isAdding={mutations.beginPasskey.isPending || mutations.finishPasskey.isPending}
        onChange={(patch) => setPasskeyForm({ ...passkeyForm, ...patch })}
        onClose={() => {
          setPasskeyAddOpen(false);
          setPasskeyForm({ ...emptyCredentialForm, name: '' });
        }}
        onSubmit={addPasskey}
      />
      <PasskeyNameDialog passkey={renamePasskey} form={renameForm} requiresMFA={requiresMFA} onChange={(patch) => setRenameForm({ ...renameForm, ...patch })} onClose={() => setRenamePasskey(null)} onSubmit={submitRenamePasskey} />
      <PasskeyDeleteDialog passkey={deletePasskey} form={deleteForm} requiresMFA={requiresMFA} onChange={(patch) => setDeleteForm({ ...deleteForm, ...patch })} onClose={() => setDeletePasskey(null)} onSubmit={submitDeletePasskey} />
    </div>
  );
}

function SecuritySkeleton() {
  return (
    <div className="flex flex-col gap-5 pb-10">
      <Skeleton className="h-10 w-full max-w-md rounded-lg" />
      <Skeleton className="h-[360px] w-full rounded-xl" />
    </div>
  );
}

function SecuritySectionTrigger({ value, icon: Icon, title, description }: {
  value: string;
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  description?: string;
}) {
  return (
    <TabsTrigger
      value={value}
      className={cn(
        'h-8 min-w-0 gap-2 px-3 text-sm font-semibold',
        'data-active:text-primary data-active:shadow-sm',
      )}
    >
      <Icon data-icon="inline-start" />
      <span className="truncate">{title}</span>
      {description ? <span className="sr-only">{description}</span> : null}
    </TabsTrigger>
  );
}

function AccountPasswordSection({
  currentUser,
  onEditUsername,
  onEditPassword,
}: {
  currentUser: { username: string; role: string; created_at: string };
  onEditUsername: () => void;
  onEditPassword: () => void;
}) {
  const { t } = useTranslation();

  return (
    <SecurityPanel
      icon={UserRound}
      title={t('admin.accountPasswordTab')}
      description={t('admin.accountPasswordDescription')}
      badge={<Badge variant="secondary">{currentUser.role}</Badge>}
    >
      <div className="rounded-lg border border-border/50 bg-muted/15 p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('admin.currentAdmin')}
            </p>
            <p className="mt-1 truncate text-lg font-semibold">{currentUser.username}</p>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>{t('admin.accountCreated')}</p>
            <p className="font-medium text-foreground">{formatDate(currentUser.created_at)}</p>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-border/50 bg-background/70">
        <SettingRow
          icon={UserRound}
          title={t('admin.updateUsername')}
          description={t('admin.accountProfileDescription')}
          value={currentUser.username}
          actionLabel={t('admin.updateUsername')}
          onAction={onEditUsername}
        />
        <Separator />
        <SettingRow
          icon={LockKeyhole}
          title={t('admin.updatePassword')}
          description={t('admin.passwordSecurityDescription')}
          value={t('admin.passwordConfigured')}
          actionLabel={t('admin.updatePassword')}
          onAction={onEditPassword}
        />
      </div>
    </SecurityPanel>
  );
}

function TOTPSection({
  enabled,
  recoveryCodesRemaining,
  form,
  requiresMFA,
  isBeginning,
  isRegenerating,
  isDisabling,
  onFormChange,
  onBegin,
  onRegenerate,
  onDisable,
}: {
  enabled: boolean;
  recoveryCodesRemaining: number;
  form: CredentialForm;
  requiresMFA: boolean;
  isBeginning: boolean;
  isRegenerating: boolean;
  isDisabling: boolean;
  onFormChange: (patch: Partial<CredentialForm>) => void;
  onBegin: (event: React.FormEvent) => void;
  onRegenerate: () => void;
  onDisable: () => void;
}) {
  const { t } = useTranslation();

  return (
    <SecurityPanel
      icon={ShieldCheck}
      title={t('admin.twoFactorAuth')}
      description={t('admin.totpPanelDescription')}
      badge={(
        <Badge variant={enabled ? 'default' : 'secondary'}>
          {enabled ? t('common.enabled') : t('common.disabled')}
        </Badge>
      )}
    >
      <FactorStatusRow
        enabled={enabled}
        title={enabled ? t('admin.totpEnabled') : t('admin.totpDisabled')}
        description={
          enabled
            ? t('admin.totpEnabledDescription', { count: recoveryCodesRemaining })
            : t('admin.totpDisabledDescription')
        }
      />

      <form onSubmit={onBegin} className="flex max-w-2xl flex-col gap-4">
        <CredentialBlock
          requiresMFA={requiresMFA}
          form={form}
          onChange={onFormChange}
        />
        {!enabled ? (
          <div className="flex justify-end">
            <Button type="submit" disabled={isBeginning}>
              <Plus data-icon="inline-start" />
              {t('admin.enableTOTP')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={onRegenerate}
              disabled={isRegenerating}
            >
              <RotateCcw data-icon="inline-start" />
              {t('admin.regenerateRecoveryCodes')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={onDisable}
              disabled={isDisabling}
            >
              <X data-icon="inline-start" />
              {t('admin.disableTOTP')}
            </Button>
          </div>
        )}
      </form>
    </SecurityPanel>
  );
}

function PasskeySection({
  passkeys,
  webauthn,
  passkeySupported,
  onAddRequest,
  onRename,
  onDelete,
}: {
  passkeys: PasskeySummary[];
  webauthn: { origin: string; rp_id: string };
  passkeySupported: boolean;
  onAddRequest: () => void;
  onRename: (passkey: PasskeySummary) => void;
  onDelete: (passkey: PasskeySummary) => void;
}) {
  const { t } = useTranslation();

  return (
    <SecurityPanel
      icon={Fingerprint}
      title={t('admin.passkeys')}
      description={t('admin.passkeyPanelDescription')}
      badge={<Badge variant="secondary">{passkeys.length}</Badge>}
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="grid gap-3 rounded-lg border border-border/50 bg-muted/15 p-4 text-sm">
          <MetaLine label={t('admin.webauthnOrigin')} value={webauthn.origin || t('common.unknown')} />
          <MetaLine label={t('admin.webauthnRpId')} value={webauthn.rp_id || t('common.unknown')} />
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {passkeySupported ? <CheckCircle2 className="text-primary" /> : <ShieldOff />}
            <span>{passkeySupported ? t('admin.browserReady') : t('admin.browserUnavailable')}</span>
          </div>
        </div>

        <div className="rounded-lg border border-border/50 bg-background/70 p-4">
          <SectionTaskHeader icon={Plus} title={t('admin.addPasskey')} description={t('admin.passkeyAddDescription')} />
          <Button
            type="button"
            className="mt-4 w-full"
            disabled={!passkeySupported}
            onClick={onAddRequest}
          >
            <Plus data-icon="inline-start" />
            {t('admin.addPasskey')}
          </Button>
        </div>
      </div>

      <PasskeyList
        passkeys={passkeys}
        onRename={onRename}
        onDelete={onDelete}
      />
    </SecurityPanel>
  );
}

function SettingRow({
  icon: Icon,
  title,
  description,
  value,
  actionLabel,
  onAction,
}: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  value: string;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/45 text-muted-foreground">
          <Icon />
        </div>
        <div className="min-w-0">
          <p className="font-semibold">{title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="flex min-w-0 items-center gap-3 sm:justify-end">
        <span className="min-w-0 truncate rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
          {value}
        </span>
        <Button type="button" variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function SectionTaskHeader({ icon: Icon, title, description }: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground">
        <Icon />
      </div>
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function SecurityPanel({ icon: Icon, title, description, badge, children }: {
  icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  title: string;
  description: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border/50 bg-background/85 shadow-sm">
      <div className="flex items-start justify-between gap-4 border-b border-border/40 bg-background p-5">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border/50 bg-muted/30 text-primary shadow-sm">
            <Icon />
          </div>
          <div className="min-w-0">
            <h3 className="font-semibold text-foreground">{title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        {badge}
      </div>
      <div className="flex flex-col gap-5 p-5">
        {children}
      </div>
    </section>
  );
}

function FactorStatusRow({ enabled, title, description }: {
  enabled: boolean;
  title: string;
  description: string;
}) {
  return (
    <div className={cn(
      'flex items-start gap-3 rounded-lg border p-4',
      enabled ? 'border-primary/25 bg-primary/5' : 'border-border/50 bg-muted/20',
    )}>
      <div className={cn(
        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg',
        enabled ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground',
      )}>
        {enabled ? <CheckCircle2 /> : <ShieldOff />}
      </div>
      <div>
        <p className="text-sm font-medium">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function CredentialBlock({ requiresMFA, form, compact = false, onChange }: {
  requiresMFA: boolean;
  form: CredentialForm;
  compact?: boolean;
  onChange: (patch: Partial<CredentialForm>) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className={cn('rounded-lg border border-border/50 bg-muted/20 p-4', compact && 'p-3')}>
      <div className="mb-3 flex items-start gap-2">
        <KeyRound className="mt-0.5 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">{t('admin.credentialsRequiredTitle')}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{t('admin.credentialsRequiredDescription')}</p>
        </div>
      </div>
      <div className={cn('grid gap-3', requiresMFA && 'sm:grid-cols-2')}>
        <Input
          type="password"
          value={form.currentPassword}
          onChange={(e) => onChange({ currentPassword: e.target.value })}
          placeholder={t('admin.currentPassword')}
          autoComplete="current-password"
        />
        {requiresMFA ? (
          <Input
            value={form.mfaCode}
            onChange={(e) => onChange({ mfaCode: e.target.value })}
            placeholder={t('admin.mfaCode')}
            inputMode="numeric"
            autoComplete="one-time-code"
          />
        ) : null}
      </div>
    </div>
  );
}

function LabeledInput({ id, label, value, onChange, type = 'text', autoComplete }: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  autoComplete?: string;
}) {
  return (
    <label htmlFor={id} className="flex flex-col gap-2">
      <span className="text-sm font-medium">{label}</span>
      <Input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
      />
    </label>
  );
}

function UsernameDialog({
  open,
  form,
  requiresMFA,
  isPending,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: CredentialForm & { newUsername: string };
  requiresMFA: boolean;
  isPending: boolean;
  onChange: (patch: Partial<CredentialForm & { newUsername: string }>) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.updateUsername')}</DialogTitle>
            <DialogDescription>{t('admin.accountProfileDescription')}</DialogDescription>
          </DialogHeader>
          <LabeledInput
            id="admin-new-username"
            label={t('admin.newUsername')}
            value={form.newUsername}
            onChange={(value) => onChange({ newUsername: value })}
            autoComplete="username"
          />
          <CredentialBlock
            compact
            requiresMFA={requiresMFA}
            form={form}
            onChange={onChange}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={isPending}>
              <Check data-icon="inline-start" />
              {t('admin.updateUsername')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({
  open,
  form,
  requiresMFA,
  isPending,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: CredentialForm & { newPassword: string };
  requiresMFA: boolean;
  isPending: boolean;
  onChange: (patch: Partial<CredentialForm & { newPassword: string }>) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.updatePassword')}</DialogTitle>
            <DialogDescription>{t('admin.passwordSecurityDescription')}</DialogDescription>
          </DialogHeader>
          <LabeledInput
            id="admin-new-password"
            label={t('admin.newPassword')}
            type="password"
            value={form.newPassword}
            onChange={(value) => onChange({ newPassword: value })}
            autoComplete="new-password"
          />
          <CredentialBlock
            compact
            requiresMFA={requiresMFA}
            form={form}
            onChange={onChange}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={isPending}>
              <Check data-icon="inline-start" />
              {t('admin.updatePassword')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasskeyAddDialog({
  open,
  form,
  requiresMFA,
  passkeySupported,
  isAdding,
  onChange,
  onClose,
  onSubmit,
}: {
  open: boolean;
  form: CredentialForm & { name: string };
  requiresMFA: boolean;
  passkeySupported: boolean;
  isAdding: boolean;
  onChange: (patch: Partial<CredentialForm & { name: string }>) => void;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const { t } = useTranslation();

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <DialogContent>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{t('admin.addPasskey')}</DialogTitle>
            <DialogDescription>{t('admin.passkeyAddDescription')}</DialogDescription>
          </DialogHeader>
          {!passkeySupported ? (
            <FactorStatusRow enabled={false} title={t('admin.browserUnavailable')} description={t('admin.passkeyUnsupported')} />
          ) : null}
          <LabeledInput
            id="admin-passkey-name"
            label={t('admin.passkeyName')}
            value={form.name}
            onChange={(value) => onChange({ name: value })}
          />
          <CredentialBlock
            compact
            requiresMFA={requiresMFA}
            form={form}
            onChange={onChange}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
            <Button type="submit" disabled={!passkeySupported || isAdding}>
              <Plus data-icon="inline-start" />
              {t('admin.addPasskey')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function MetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate font-medium" title={value}>{value}</span>
    </div>
  );
}

function PasskeyList({ passkeys, onRename, onDelete }: {
  passkeys: PasskeySummary[];
  onRename: (passkey: PasskeySummary) => void;
  onDelete: (passkey: PasskeySummary) => void;
}) {
  const { t } = useTranslation();

  if (passkeys.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/70 bg-background/60 p-5 text-center">
        <Fingerprint className="mx-auto text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">{t('admin.noPasskeys')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('admin.noPasskeysDescription')}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {passkeys.map((passkey) => (
        <div key={passkey.id} className="rounded-lg border border-border/50 bg-background/70 p-4 transition-colors hover:bg-muted/20">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Fingerprint className="shrink-0 text-primary" />
                <p className="truncate font-medium">{passkey.name}</p>
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={passkey.origin}>{passkey.origin}</p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => onRename(passkey)} title={t('common.edit')} aria-label={t('common.edit')}>
                <Pencil />
              </Button>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDelete(passkey)} title={t('common.delete')} aria-label={t('common.delete')}>
                <Trash2 />
              </Button>
            </div>
          </div>
          <Separator className="my-3" />
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
            <div className="flex items-center gap-1.5">
              <CalendarClock />
              <span>{t('admin.passkeyCreated')}: {formatDate(passkey.created_at)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <CheckCircle2 />
              <span>{t('admin.passkeyLastUsed')}: {passkey.last_used_at ? formatDate(passkey.last_used_at) : t('admin.passkeyNeverUsed')}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TOTPSetupDialog({ setup, code, onCodeChange, onCancel, onConfirm }: {
  setup: TOTPBeginResponse | null;
  code: string;
  onCodeChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!setup} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="sm:max-w-[620px]">
        <DialogHeader>
          <DialogTitle>{t('admin.enableTOTP')}</DialogTitle>
          <DialogDescription>{t('admin.totpSetupDescription')}</DialogDescription>
        </DialogHeader>
        {setup ? (
          <div className="grid gap-5 sm:grid-cols-[220px_1fr]">
            <div className="rounded-xl border border-border/50 bg-background p-3">
              <img src={setup.qr_data_url} alt={t('admin.totpQRCode')} className="aspect-square w-full rounded-lg" />
            </div>
            <div className="flex flex-col gap-4">
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('admin.totpSecret')}</span>
                <Input value={setup.secret} readOnly className="font-mono" />
              </label>
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">{t('admin.mfaCode')}</span>
                <Input value={code} onChange={(e) => onCodeChange(e.target.value)} inputMode="numeric" autoComplete="one-time-code" />
              </label>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>{t('common.cancel')}</Button>
          <Button type="button" onClick={onConfirm}>{t('common.confirm')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecoveryCodesDialog({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={codes.length > 0} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.recoveryCodes')}</DialogTitle>
          <DialogDescription>{t('admin.recoveryCodesDescription')}</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-2">
          {codes.map((code) => (
            <code key={code} className="rounded-md border bg-muted px-3 py-2 text-center text-sm font-medium">{code}</code>
          ))}
        </div>
        <DialogFooter>
          <Button type="button" onClick={onClose}>{t('admin.savedRecoveryCodes')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasskeyNameDialog({ passkey, form, requiresMFA, onChange, onClose, onSubmit }: {
  passkey: PasskeySummary | null;
  form: CredentialForm & { name: string };
  requiresMFA: boolean;
  onChange: (patch: Partial<CredentialForm & { name: string }>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!passkey} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.renamePasskey')}</DialogTitle>
          <DialogDescription>{passkey?.origin}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <LabeledInput id="admin-rename-passkey" label={t('admin.passkeyName')} value={form.name} onChange={(value) => onChange({ name: value })} />
          <CredentialBlock requiresMFA={requiresMFA} form={form} onChange={onChange} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" onClick={onSubmit}>{t('common.save')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasskeyDeleteDialog({ passkey, form, requiresMFA, onChange, onClose, onSubmit }: {
  passkey: PasskeySummary | null;
  form: CredentialForm;
  requiresMFA: boolean;
  onChange: (patch: Partial<CredentialForm>) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={!!passkey} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('admin.deletePasskey')}</DialogTitle>
          <DialogDescription>{passkey?.name}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <FactorStatusRow enabled={false} title={t('admin.deletePasskey')} description={t('admin.deletePasskeyDescription')} />
          <CredentialBlock requiresMFA={requiresMFA} form={form} onChange={onChange} />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="button" variant="destructive" onClick={onSubmit}>{t('common.delete')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDate(value?: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
