import WorkspaceChrome from '@/components/WorkspaceChrome';
import CoachProfileEditor from '@/components/coach/CoachProfileEditor';

export default function CoachProfilePage() {
  return (
    <WorkspaceChrome pageLabel="Coach profile">
      <CoachProfileEditor />
    </WorkspaceChrome>
  );
}
