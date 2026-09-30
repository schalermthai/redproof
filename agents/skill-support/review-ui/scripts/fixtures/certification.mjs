// Synthetic preview data for renderer/collector tests, never certification evidence.
export function certificationFixture() {
  const describe = 'Gate: requests\n\nRules:\n  R1 Invalid requests stop before connecting.\n\nCheck:\n  Run native request tests.';
  const gate = {
    id: 'requests', title: 'Keep requests valid', summary: 'Selected request cases verified in this fictional example.',
    example: 'Malformed input is rejected before connecting.', evidence: 'Synthetic UI test data, not an executed project.', describe,
    certification: {
      status: 'implemented-and-verified', decision: 'trusted',
      designReference: 'Illustrative design revision 1; no real approval.', designDescribe: describe,
      actualDescribeSource: 'Illustrative formatter-shaped output, not captured CLI evidence.',
      comparison: [{promise:'R1 request validation', planned:'Native request cases', actual:'Example cases complete; hypothetical record A', disposition:'delivered'}],
      verification: 'Illustrative RED/GREEN/REFUSE established; restored. Author review only. Not real evidence.',
      insights: 'A successful command alone would not establish complete inspection.',
      improvements: 'Example completion validation added; fictional verification record A.',
      nextStep: 'Optional: design support for redirects; no implementation until the contract is settled.',
    },
    actions: [
      {id:'revise',label:'Design redirect coverage',description:'Design only: define redirect cases and evidence; no code execution.'},
      {id:'implement',label:'Improve the completion diagnostic',description:'Improve only diagnostics in the named copy, preserve the contract and rerun certification.'},
      {id:'later',label:'Keep as is for now',description:'No further work; existing Gate remains unchanged.',recommended:true},
      {id:'skip',label:'Skip follow-up',description:'Do not pursue this follow-up; do not disable the Gate.'},
    ],
  };
  const blocked = structuredClone(gate);
  blocked.id = 'lint'; blocked.title = 'Keep lint debt from growing'; blocked.summary = 'Real producer unavailable in this fictional example.';
  blocked.describe = null;
  Object.assign(blocked.certification, {
    status:'blocked', decision:'not-trusted', designDescribe:null,
    designReference:'Original design artifact unavailable; comparison is limited to supplied brief.',
    actualDescribeSource:'No Gate implementation exists.', verification:'No real-tool run or proofs. No restoration needed.',
    insights:'Tool access is still required.', improvements:'None; execution did not start.', nextStep:'Provide the producer source before implementation can continue.',
    comparison:[{promise:'Complete lint evidence',planned:'Run the real producer',actual:'Tool inaccessible; not run',disposition:'blocked'}],
  });
  blocked.actions = [{id:'investigate',label:'Investigate tool access',description:'Read-only: inspect the supplied tool URL and report availability; no installation.',recommended:true}, ...gate.actions.slice(-2).map(a=>({...a,recommended:false}))];
  return {version:1,reviewId:'certification-preview',stage:'certification',preview:true,title:'Results and next steps',
    background:'A synthetic UI preview: one verified Gate and one blocked Gate.',recommendation:'Keep the verified scope; resolve the blocked tool input first.',
    evidenceStatus:'UI test data only. No project was certified by this preview.',workArea:'Named disposable workspace only.',boundaries:'No installs, CI, adoption, commits or publication.',gates:[gate,blocked]};
}
