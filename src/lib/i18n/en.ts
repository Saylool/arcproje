/**
 * ENGLISH DICTIONARY.
 *
 * Declared as `Dictionary`, which is derived from the Turkish dictionary, so
 * TypeScript REJECTS a missing key and REJECTS an accidental extra one. Key
 * parity between the two languages is therefore a compile-time guarantee, and
 * a runtime test asserts it a second time.
 *
 * ROLE VOCABULARY — never blurred, because reversing it would reverse a
 * transfer:
 *   - "bill payer" / "recipient" — the person who paid the receipt and who
 *     RECEIVES the USDC transfer;
 *   - "debtor" / "sender"       — the person who owes and who SENDS it.
 * The bare word "payer" is avoided wherever it could be read as either side.
 *
 * Text here is PLAIN TEXT: no markup, never injected as HTML.
 */

import type { Dictionary } from "./tr";

export const en: Dictionary = {
  app: {
    name: "Split the Bill",
    tagline:
      "Upload your receipt, share the items among your friends, and work out what everyone owes.",
  },

  language: {
    label: "Select language",
    tr: "Türkçe",
    en: "English",
  },

  theme: {
    toDark: "Switch to dark mode",
    toLight: "Switch to light mode",
    neutral: "Change theme",
  },

  auth: {
    continueWithGoogle: "Continue with Google",
    loading: "Working…",
    signOut: "Sign out",
    signedInState: "Google session",
    safeFallbackName: "Signed in",
    unavailableShort: "Sign-in unavailable",
    unavailable:
      "Authentication is unavailable right now. Please try again later.",
    analysisRequired: "Sign in with Google to analyze a receipt.",
    chooseAgainAfterSignIn:
      "For your privacy, the selected image is not kept during the sign-in redirect. You will need to choose the receipt image again when you return.",
    failureTitle: "Sign-in could not be completed",
    failureMessage:
      "Authentication could not be completed right now. Return to the home page and try again.",
    backHome: "Return to home",
  },

  metadata: {
    homeTitle: "Split the Bill — Upload your receipt",
    homeDescription:
      "Upload your receipt, share the items among your friends, and work out what everyone owes.",
    payTitle: "Payment request — Split the Bill",
    payDescription:
      "Pay the signed payment request that was sent to you, from your own wallet.",
    sharedBillTitle: "Shared bill — Split the Bill",
    sharedBillDescription:
      "Connect your wallet and sign an authentication message to see what you owe.",
    authErrorTitle: "Sign-in error — Split the Bill",
    privacyTitle: "Privacy Policy — Split the Bill",
    privacyDescription:
      "Which data Split the Bill processes, where it goes and how long it is kept.",
    accountTitle: "Your account — Split the Bill",
    accountDescription:
      "Permanently remove the record created by your Google sign-in, along with the personal data attached to it.",
  },
  account: {
    heading: "Your account",
    signedOutTitle: "You are not signed in",
    signedOutBody:
      "To delete your account you first need to sign in with Google. If you have never signed in, there is no account record to remove.",
    deleteHeading: "Delete my account",
    deleteIntro:
      "This cannot be undone. Read what goes and what stays before you delete.",
    goesHeading: "What gets deleted",
    goesEmail: "Your verified email address",
    goesName: "Your display name and the address of your profile picture",
    goesContacts: "Your saved contact book (names and addresses)",
    staysHeading: "What stays",
    staysBills:
      "The shared bills you created. Other people owe money in them, and we do not close their way to pay. The records lose their owner and their link to you.",
    staysChain:
      "Transfers written to the chain. Those are public and permanent; a deletion right does not reach them.",
    startButton: "I want to delete my account",
    confirmQuestion: "We cannot undo this. Shall we go ahead?",
    confirmButton: "Yes, delete my account",
    cancelButton: "Keep my account",
    working: "Deleting…",
    doneTitle: "Your account is gone",
    doneBody:
      "Your record and your saved contacts were removed and you have been signed out. Signing in again with the same Google account starts a brand new record.",
    failed: "The account could not be deleted. Please try again shortly.",
    contactNote:
      "If you cannot reach the app, you can send a deletion request to this address:",
  },


  common: {
    back: "Go back",
    copy: "Copy",
    copied: "Copied",
    share: "Share",
    remove: "Remove",
    change: "Change",
    delete: "Delete",
    unnamed: "(unnamed)",
    unknownParticipant: "Unknown participant",
    notSelected: "Not selected",
    notEntered: "Not entered",
    notConnected: "Not connected",
    dash: "—",
    addressPlaceholder: "0x…",
    testNetworkBadge: "TEST NETWORK",
    copyAddress: "Copy address",
    addressCopied: "Address copied to clipboard.",
    addressCopyFailed:
      "Your browser denied clipboard access. You can select the address above and copy it manually.",
    linkCopyFailed: "The link could not be copied. You can select and copy it manually.",
    faucet: "Circle Faucet",
    arcDocs: "Arc documentation",
    arcSetup: "Arc Testnet setup",
    viewOnArcScan: "View on ArcScan",
    openOnArcScan: "Open the transaction on ArcScan",
    showOnArcScan: "View on ArcScan",
    transaction: "Transaction:",
    unknownChain: "unknown",
  },

  wallet: {
    fallbackName: "Wallet",
    connect: "Connect wallet",
    connectAccount: "Connect account",
    connectShort: "Connect",
    select: "Select a wallet",
    notFound: "No wallet found in this browser.",
    notFoundInstall:
      "No wallet found in your browser. Install an EIP-6963 wallet such as MetaMask and reload the page.",
    multipleFound: "More than one wallet found, pick one:",
    connectRejected: "The wallet connection was rejected.",
    connectFailed: "Could not connect to the wallet.",
    switchTo: "Switch to {network}",
    switchToArc: "Switch to Arc Testnet",
    switchRejected: "The network change was rejected.",
    switchFailed: "Could not switch to Arc Testnet.",
    switchIgnored:
      "Your wallet accepted the request but did not change the network.",
    switchUnsupported: "Your wallet does not know Arc Testnet.",

    addManuallyTitle: "Add the network to your wallet by hand",
    addManuallyIntro:
      "Trying again will not fix this. Add the network below in your wallet, then try again.",
    networkName: "Network name",
    chainId: "Chain ID",
    rpcUrl: "RPC URL",
    symbol: "Symbol",
    explorer: "Explorer",
    copyNetwork: "Copy network details",
    connectedAccount: "Connected account:",
    connectedWallet: "Connected wallet:",
    notArcWithChain: "Not Arc Testnet (chain {chainId})",
    recipientIs: "Recipient:",
    recipientIsYou: "Recipient (you):",

    walletConnect: "Connect a mobile wallet",
    walletConnectScan: "Scan this code with the wallet on your phone.",
    walletConnectOpen: "Open in the wallet app",
    walletConnectQrLabel: "WalletConnect pairing QR code",
    walletConnectWaiting: "Waiting for approval in your wallet…",
    walletConnectCancel: "Cancel",
    walletConnectFailed: "Could not start the WalletConnect session.",
    walletConnectArcNotice:
      "If your wallet does not know Arc Testnet the connection still succeeds; you will then be asked to switch networks.",
  },

  legal: {
    accountLink: "Your account",
    effectiveFrom: "In effect from {date}",
    privacyLink: "Privacy",
    footerLabel: "Site footer",
    backHome: "Back to home",
  },

  progress: {
    label: "Progress",
    receipt: "Receipt",
    participants: "Participants",
    payment: "Payment",
    current: "(current step)",
    completed: "(completed)",
    upcoming: "(later stage, not ready yet)",
    notCompleted: "(not completed yet)",
  },

  flow: {
    receiptTitle: "Upload your receipt",
    receiptDescription:
      "Add a photo of the receipt. In the next steps you will share the items among participants and work out everyone's share.",
    participantsTitle: "Share the items among participants",
    participantsDescription:
      "Add participants and mark who had each item. You can assign one item to more than one participant.",
    summaryTitle: "Share the items among participants",
    summaryDescription:
      "Your assignments are ready. Review them and calculate everyone's share.",
    debtsTitle: "Review the shares",
    debtsDescription:
      "Everyone's share and what they owe the bill payer are below. Amounts are split down to the last kuruş.",
    paymentTitle: "Create a payment request",
    paymentDescription:
      "You paid the bill. Sign a separate payment request for each debtor; each debtor confirms it in their own wallet.",

    analyze: "Analyze receipt",
    analyzing: "Analyzing…",
    retry: "Try again",
    reanalyze: "Analyze again",
    uploadNotice:
      "Your receipt image is sent to OpenAI for analysis. The image is not stored on the server.",
    reading: "Reading the items on the receipt, this may take a few seconds…",
    toParticipants: "Share among participants",
    checkBeforeSplit:
      "Check the amounts before sharing the items among participants.",

    liveAnalyzing: "Analyzing the receipt.",
    livePayment: "You are on the payment request step.",
    liveDebts: "Shares calculated.",
    liveSummary: "Assignments are ready. Showing the summary.",
    liveParticipants: "You are on the participant assignment step.",
    liveReady: "Receipt analysis complete. You can edit the items.",
  },

  upload: {
    remainingAnalyses: "Analyses left today: {count}",
    sectionLabel: "Receipt upload",
    inputLabel: "Choose a receipt image",
    dropHere: "Drag your receipt here",
    orPick: "or choose an image from your device",
    pickButton: "Choose receipt image",
    hint: "JPG, PNG or WEBP · 10 MB maximum",
    previewAlt: "Selected receipt image: {name}",
    selectedLive: "{name} selected. Ready to upload the receipt.",

    unsupportedType:
      "This file type is not supported. Please choose a receipt image in JPG, PNG or WEBP format.",
    emptyFile: "The file looks empty. Please choose a readable photo of the receipt.",
    tooLarge: "The image is too large ({size}). You can upload up to 10 MB.",
  },

  editor: {
    sectionLabel: "Receipt contents",
    unknownMerchant: "Merchant name could not be read",
    currencyLine: "Currency: {currency} · Review the analysis result and correct it.",
    unknownCurrency: "could not be determined",
    /* The model returns CODES; the sentence is chosen here. Receipt content is never translated. */
    analysisWarnings: {
      TOTAL_UNREADABLE:
        "The grand total on the receipt could not be read; please check and correct it.",
      TOTALS_DO_NOT_MATCH:
        "The item lines do not add up to the printed total; review the amounts.",
      TAX_TREATMENT_UNCLEAR:
        "It was unclear whether tax is included in the prices or added separately; check the setting.",
      SERVICE_TREATMENT_UNCLEAR:
        "It was unclear whether the service charge is included or added separately; check the setting.",
      DISCOUNT_TREATMENT_UNCLEAR:
        "It was unclear whether the discount is included or applied separately; check the setting.",
      ITEM_PRICE_UNCLEAR:
        "At least one item price was not clearly legible; compare the prices.",
      ITEM_NAME_UNCLEAR:
        "At least one item name was not clearly legible; you can correct the names.",
      PARTIALLY_UNREADABLE:
        "Part of the receipt could not be read; some lines may be missing.",
      CURRENCY_UNCLEAR:
        "The currency could not be determined from the receipt; make sure it is right.",
    },
    analysisNotes: "Analysis notes",
    items: "Items",
    emptyItems: "The item list is empty. You can add items below.",
    itemNamePlaceholder: "Item name",
    itemNameLabel: "Name of item {index}",
    itemAmountLabel: "Amount of item {index}",
    itemDeleteLabel: "Delete item {index}",
    addItem: "+ Add item",
    itemsSubtotal: "Items subtotal",
    tax: "Tax (VAT)",
    serviceCharge: "Service charge",
    discount: "Discount",
    total: "Grand total",
    addsToTotal: "If “Apply separately” is chosen, it is added to the grand total.",
    subtractsFromTotal:
      "If “Apply separately” is chosen, it is subtracted from the grand total.",
    treatmentLabel: "How {label} is applied",
    treatmentLabelWithHint: "How {label} is applied. {hint}",
    treatmentIncluded: "Included in item prices",
    treatmentSeparate: "Apply separately",
    treatmentUnknown: "Unclear",

    mismatchPrefix: "Items plus separately applied charges come to ",
    mismatchMiddle: " but the grand total on the receipt is ",
    mismatchSuffix:
      ". We do not change any value without your approval; you can review and correct it.",
    indeterminatePrefix:
      "It is unclear whether some charges are included in the item prices: ",
    indeterminateSuffix:
      ". That is why we are not verifying the grand total. Update the choices above to clarify it.",
    adjustmentTax: "tax",
    adjustmentServiceCharge: "service charge",
    adjustmentDiscount: "discount",
  },

  participants: {
    defaultName: "You",
    sectionLabel: "Participants and item assignments",
    title: "Add participants, share the items",
    description:
      "If you assign an item to more than one participant, that item is split equally among them.",
    heading: "Participants",
    empty: "No participants yet. Add one below.",
    namePlaceholder: "Name",
    nameLabel: "Name of participant {index}",
    deleteLabel: "Delete participant {name}",
    positionalName: "participant {index}",
    newNamePlaceholder: "New participant name",
    newNameLabel: "New participant name",
    add: "+ Add participant",
    payerLegend: "Who paid the bill?",
    itemsHeading: "Items",
    addPeopleFirst: "Add a participant first.",
    itemUnassigned: "This item has not been assigned to anyone yet.",
    save: "Save assignments",
    backToReceipt: "Back to receipt",

    receiptInvalid: "The receipt data is not valid. Check the amounts and try again.",
    receiptNoItems:
      "The receipt has no items. Add at least one item before sharing it among participants.",
    receiptEmptyNames:
      "Some items have no name. Give every item a name before continuing.",
    receiptInvalidAmount:
      "An amount cannot be read. If you continue without fixing the field marked in red, the debts are calculated from a different amount than the one on screen.",
    namesInvalid: "Participant names cannot be empty and cannot repeat.",
  },

  assignmentSummary: {
    sectionLabel: "Assignment summary",
    title: "Assignments are ready",
    description:
      "We have recorded who each item belongs to. Now we can work out everyone's share.",
    payer: "Bill payer",
    participantCount: "Participants",
    assignedItems: "Assigned items",
    sharedItems: "Shared items",
    calculate: "Calculate shares",
    fixReceipt: "Fix the receipt",
    editAssignments: "Edit assignments",
  },

  debts: {
    sectionLabel: "Share and debt summary",
    title: "Who owes what",
    paidBy: "{payer} paid the bill. Everyone else owes them their share.",
    payerBadge: "bill payer",
    itemShare: "Item share",
    taxShare: "Tax share",
    serviceShare: "Service share",
    discountShare: "Discount share",
    includedInPrice: "— included in price",
    totalsMatchPrefix: "The shares add up to ",
    totalsMatchSuffix:
      " — exactly the grand total on the receipt. Not a single kuruş was lost.",
    totalsMismatch:
      "The shares add up to {allocated}, while the grand total on the receipt is {stated}. This is a calculation error.",
    heading: "Debts",
    none: "Nobody other than the bill payer has a share, so no debt was created.",
    owes: "{from} owes {to}",
    /** English needs no trailing word; the row is complete without one. */
    owesSuffix: "",
    roundingDescription:
      "No indivisible kuruş is lost. A leftover kuruş on an item goes to a different participant each time, rotating by the item's position on the receipt. Separately applied tax and service charges are distributed by the largest remainder method in proportion to each participant's item share, and ties shift priority from line to line. A separately applied discount is deducted in proportion to each participant's pre-discount balance, so nobody's share can go negative through rounding.",
    createRequest: "Create a payment request",
    editAssignments: "Edit assignments",
    editReceipt: "Fix the receipt",
    footnote:
      "You sign a separate payment request for each debtor; each debtor confirms it in their own wallet. Arc Testnet test USDC is used.",
  },

  sharedBill: {
    titleOnlyTry: "Shared payment link",
    onlyTry: "This step is only available for TRY receipts.",
    title: "Create a single link",
    introPrefix:
      "You connect the bill payer's wallet once, enter an address for each debtor, and add ",
    introSignature: "a single signature",
    introMiddle: ". ",
    introAllSame: "Every debtor gets the same link.",
    noticePrefix: "This signature only ",
    noticeRequest: "creates a request",
    noticeSuffix:
      ". It cannot withdraw money from anyone's wallet and grants no transfer authority. Each debtor signs the transfer in their own wallet. Network: {network} — test USDC has no real monetary value.",
    stepWallet: "1. The bill payer's wallet",
    stepAddresses: "2. A wallet address for each debtor",
    stepLink: "3. One link — the same for everyone",
    noDebts: "There is no debt to share.",
    signing: "Signing…",
    signAndCreate: "Sign and create a single link",
    stale:
      "The inputs changed; the previous link is no longer valid. Sign again to create a new link.",
    qrLabel: "QR code for the shared payment link",
    linkNotice:
      "The link does NOT carry the debt list, the addresses or the names; it only contains an unguessable identifier. Anyone who opens the link can see the bill, so only share it with the people involved. It is valid for at most {days} days.",
    faucetPrefix: "For test USDC, see ",
    shareTitle: "Split the Bill",
    shareText: "Shared bill payment link",
    createFailed: "The shared bill could not be created. Please try again.",
  },

  /* --------------------------------------------------------------------- */
  /* Bills you created — ownership list                                      */
  /* --------------------------------------------------------------------- */
  /* Address book — derived from past bills                                  */
  /* --------------------------------------------------------------------- */
  contacts: {
    hint: "Addresses you used before",
    save: "Save",
    panelTitle: "Saved people",
    panelSubtitle:
      "Save the people you pay often; you will not type their address again.",
    panelEmpty: "You have not saved anyone yet. Add someone below.",
    historyHeading: "People you have paid before",
    historyHint: "Save any of them here permanently.",
    openBook: "Saved people",
    closeBook: "Close",
    nameField: "Name",
    addressField: "Wallet address",
    add: "Add",
    edit: "Edit",
    saveChanges: "Save",
    cancel: "Cancel",
    remove: "Delete",
    removeAll: "Delete all",
    confirmRemoveAll:
      "Every saved person will be deleted. This cannot be undone.",
    privacyNotice:
      "Saved people live only in your account, are shared with nobody, and you can delete all of them whenever you want.",
    errorLabelExists: "That name is already used by someone else.",
    errorAddressExists: "That wallet address is already saved.",
    errorInvalid: "The name or wallet address is not valid.",
    errorAddressShort: "The wallet address is short: {missing} more characters are needed after 0x.",
    errorAddressLong: "The wallet address is long: {extra} characters too many.",
    errorLimit: "You have reached the saved-people limit.",
    errorGeneric: "That did not go through. Please try again.",
    knownPerson: "You have sent to this person before",
    linkedWallet: "Wallet linked",
    unlink: "Remove",
    fullAddress: "Full address",
    suggestionsLabel: "Address suggestions from your history",
    useAddress: "Use the address for {label}",
    lastUsed: "last: {date}",
    failed: "Your saved people cannot be read right now.",
    verifyNotice:
      "A suggestion only fills the field. Verify the full address yourself before sending; a transfer to the wrong address cannot be undone.",
  },

  /* --------------------------------------------------------------------- */
  myBills: {
    title: "Bills you created",
    subtitle:
      "Shared payment links you created with this Google account only.",
    authorityNotice:
      "This list is a record, nothing more. Creating a bill grants NO payment authority: only the debtor moves money, by signing in their own wallet.",
    refresh: "Refresh",
    loading: "Loading your bills…",
    empty: "You have not created a shared payment link with this account yet.",
    truncated:
      "Showing only your {count} most recent bills; older ones are not in this list.",
    failed: "Your bill list cannot be read right now. Please try again shortly.",
    copyLink: "Copy link",
    copied: "Copied",
    copyFailed:
      "Your browser denied clipboard access. You can open the link and copy it from the address bar.",
    openLink: "Open link",
    issuedAt: "Issued: {date}",
    expiresAt: "Expires: {date}",
    statusOpen: "Open",
    statusClosed: "Closed",
    statusExpired: "Expired",
    amountPaid: "{paid} / {total} paid",
    listLabel: "List of the shared bills you created",
  },

  sharedPay: {
    sectionLabel: "Shared bill",
    title: "Shared bill — what you owe",
    introPrefix: "This link was sent to ",
    introEveryone: "everyone",
    introMiddle: " in the group. To see what you owe, connect your wallet and sign an ",
    introAuthMessage: "authentication message",
    introSuffix: ".",
    noticePrefix: "This signature is ",
    noticeNotATransaction: "not a transaction",
    noticeSuffix:
      ": it approves no token, grants no transfer authority and withdraws nothing from your wallet. It only proves that you control this address. It is not identity verification, only proof of address ownership. Valid for {minutes} minutes.",
    authenticate: "Sign and show what I owe",
    stepChallenge: "Requesting access…",
    stepSignature: "Waiting for the signature in your wallet…",
    stepLookup: "Looking up the debt…",
    stepVerify: "Verifying the signature and the proof…",
    yourDebt: "What you owe",
    debtorToRecipient: "{debtor} → {recipient} (bill payer)",
    recipientAddress: "Recipient wallet address",
    validUntil: "This link is valid until {date}.",
    networkNotePrefix: "Network: {network}. Test USDC ",
    networkNoteStrong: "has no real monetary value",
    networkNoteSuffix: ". For test funds, see ",

    payTitle: "Pay what you owe",
    notOnArcPrefix: "To pay, your wallet must be on the ",
    notOnArcNetwork: "Arc Testnet",
    notOnArcSuffix: " network.",
    getRate: "Get the current rate",
    stepRate: "Fetching the current rate…",
    stepEstimate: "Estimating the transaction…",
    stepReserve: "Reserving the payment…",
    stepWalletConfirm: "Waiting for confirmation in your wallet…",
    rowDebtTry: "Debt (TRY)",
    rowRate: "Rate (1 USDC)",
    rowToSend: "To send",
    rowRateExpires: "Rate quote expires",
    rowEstimatedFee: "Estimated fee",
    recipientAddressFull: "Recipient wallet address (full)",
    rateSourcePrefix: "Rate source: ",
    rateSourceName: "CoinGecko",
    rateSourceSuffix:
      " (quote verified by the server). The amount is derived from your debt and this rate using integer arithmetic.",
    estimateButton: "Estimate the transaction",
    reviewNoticePrefix: "Check the sender, recipient, amount and network above ",
    reviewNoticeOneByOne: "one by one",
    reviewNoticeMiddle:
      ". When you press confirm, your wallet will open and the transfer will be signed ",
    reviewNoticeOnlyYou: "by you alone",
    reviewNoticeSuffix: ".",
    payWithArc: "Pay with Arc Testnet",
    confirmingStrong: "Verifying.",
    confirmingMiddle: " The payment is ",
    confirmingNotDone: "not considered complete",
    paidStrong: "Paid.",
    paidRest:
      " The server verified the transaction on Arc Testnet: sender, recipient and amount matched exactly.",
    noteSubmitted: "Transaction submitted; the server is verifying it on chain…",
    noteAmbiguous: "The result is uncertain; the server is verifying it on chain…",
    noteNetworkRetry: "No response from the network; retrying…",
    noteWaitingConfirmations: "Waiting for confirmations on chain ({seen}/{required})…",
    notOnArcNotSent: "Your wallet is not on Arc Testnet. Nothing was submitted.",
    unexpectedReconcile:
      "The server returned an unexpected reconciliation response. Check the transaction on ArcScan.",
    reverted:
      "The transaction reached the chain but FAILED (revert). No payment was made; gas may have been spent. See the details on ArcScan.",
    reviewRequired:
      "The transaction was verified but does NOT prove the expected transfer (amount, party or token does not match). The debt was NOT marked as paid and automatic retry is DISABLED. Check it on ArcScan and talk to the person who created the bill.",
    reconcileTimeout:
      "The result of the transaction could not be verified in the time allowed. DO NOT RETRY: the same payment could go out twice. Check it on ArcScan using the link below; you can reload this page later to query the status again.",
    startFailed: "The payment could not be started. Please try again.",
    viewFailed: "The debt could not be shown. Please try again.",
  },

  request: {
    sectionLabel: "Create a payment request",
    title: "Create a payment request",
    introPrefix: "You paid the bill, so you are the ",
    introRecipient: "recipient",
    introMiddle: ". You sign a separate request for each debt; ",
    introDebtorOpens: "the debtor opens this link and confirms the payment in their own wallet.",
    introSuffix:
      " Your signature only creates the request, it withdraws money from nobody's wallet.",
    notTry:
      "This receipt is not in TRY ({currency}). Arc payment is currently supported only for TRY receipts.",
    stepWallet: "1 · Bill payer / recipient wallet",
    stepRate: "2 · Rate (automatic)",
    stepDebt: "3 · Debt and debtor / sender address",
    stepSign: "4 · Sign the request",
    stepLink: "5 · Request link",
    rateLoading: "Fetching the rate…",
    rateRetry: "Retry the rate",
    rateRefresh: "Refresh the rate",
    rowRate: "Rate",
    rowUpdated: "Updated",
    rowValidity: "Validity",
    rateExpiredShort: "expired",
    rateCountdown: "{minutes} min {seconds} sec",
    rateExpired: "The rate quote expired. Refresh the rate to create a request.",
    rateExplains:
      "The rate is fetched on the server and signed by the server; that signed quote is written into the payment request. The debtor's browser also has the rate verified by the server.",
    coingeckoAttribution: "Data provided by CoinGecko",
    noDebts: "There is no debt that needs a payment request.",
    debtOptionSuffix: "(debtor) owes {to} {amount}",
    debtorAddressLabel: "{name}'s wallet address",
    invalidAddress: "Not a valid wallet address.",
    rowDebtTry: "Debt (TRY)",
    rowRateSource: "Rate source",
    rowAmountRequested: "Amount requested",
    rowDebtor: "Debtor / sender",
    rowDebtorAddress: "Debtor address",
    rowPayer: "Bill payer / recipient",
    rowRecipientAddress: "Recipient address",
    rowNetwork: "Network",
    signing: "Signing in your wallet…",
    create: "Create payment request",
    signaturePrefix: "Your wallet will ask for a ",
    signatureWord: "signature",
    signatureSuffix: " only. This signature sends no money.",
    sendToPrefix: "Send this link to ",
    sendToSuffix:
      ". The debtor opens the link and confirms the payment in their own wallet.",
    qrLabel: "QR code for the request link",
    copyLink: "Copy request link",
    linkWarningPrefix:
      "This link contains participant names, wallet addresses and the payment amount; only share it with the debtor concerned. ",
    linkWarningStrong:
      "The link can only be used while the rate quote is valid — at most 5 minutes.",
    linkWarningEndsAt: " Expires: {date}",
    linkWarningExpired: " (expired)",
    linkWarningRemaining: " ({minutes} min {seconds} sec left)",
    linkWarningSuffix:
      ". The link can technically be opened again — there is no server-side or on-chain record preventing a second payment for the same debt.",
    linkExpired:
      "This link expired and can no longer be paid. Refresh the rate and sign a new request.",
    liveSigning: "Signing the payment request in your wallet.",
    liveReady: "The payment request link is ready.",
    backToShares: "Back to shares",
    faucetPrefix: "For test USDC, see ",
    faucetMiddle: ", and for network setup, see ",
    shareTitle: "Payment request",
    shareText: "Split the Bill payment request",
    refreshHint: "Refresh the rate and sign the request again.",
  },

  payer: {
    pageTitle: "Pay the payment request",
    pageDescription:
      "Review the request and confirm the payment in your own wallet. Amounts are Arc Testnet test USDC.",
    loadingRequest: "Loading the payment request…",
    sectionLabel: "Payment request",
    verifying: "Verifying the payment request…",
    invalidTitle: "This payment request is not valid",
    invalidNotice:
      "For safety, no wallet connection or payment options are shown for an invalid request. Ask the person who sent you the link for a new request.",
    noRequestInLink: "No payment request was found in the link.",
    signerMismatch:
      "The account that signed the request is not the recipient named in it. Do not trust this link.",
    signatureUnverified:
      "The signature on the payment request could not be verified. Do not trust this link.",
    title: "Payment request",
    signatureVerifiedBadge: "wallet signature verified",
    signedByPrefix: "This request was signed by the wallet at ",
    signedBySuffix: ". You confirm the payment ",
    signedByYouConfirm: "in your own wallet",
    signedByEnd: "; nobody can withdraw money from your wallet.",
    labelsWarningStrong: "Names are not proof of identity.",
    labelsWarningMiddle:
      " “{recipient}” and “{debtor}” are labels written by the person who created this request. The signature only proves that the ",
    labelsWarningAddress: "wallet address",
    labelsWarningAfterAddress:
      " signed this request; it does not prove the person's real or legal identity. Before paying, compare the full recipient address below with the bill payer over ",
    labelsWarningChannel: "a channel you trust",
    labelsWarningEnd: " (in person, by phone).",
    rowDebtor: "Debtor / sender",
    rowSenderAddress: "Sender address",
    rowPayer: "Bill payer / recipient",
    rowRecipientAddress: "Recipient address",
    rowDebtTry: "Debt (TRY)",
    rowRate: "Rate",
    rowRateSource: "Rate source",
    rowRateObservedAt: "Rate observed at",
    rowRateValidity: "Rate validity",
    rowToSend: "To send",
    rowNetwork: "Network",
    rowValidity: "Validity",
    recipientDisclosure: "Full address of the recipient (bill payer)",
    senderDisclosure: "Full address of the sender (you)",
    immutablePrefix:
      "These fields are signed and cannot be changed. The amount, the addresses and the network were set by the person who signed the request. ",
    immutableStrong:
      "A wallet signature alone does not prove that the rate is the market rate.",
    immutableSuffix:
      " The rate was fetched from CoinGecko and signed by the server, and it was verified with the server again when this page opened.",
    connectHeading: "Connect your own wallet",
    debtorMismatch:
      "The connected account is not the debtor address in the request. Only {debtor} can pay this request.",
    priorSuccess:
      "A successful submission for this request already appears to have been made from this browser. Check ArcScan before sending again.",
    priorPending:
      "A submission for this request is in progress (in this tab or another one). Wait here so the same payment is not sent twice.",
    priorReverted:
      "The submission made for this request reached the chain but FAILED (revert). No payment was made; check ArcScan and your MetaMask history before trying again.",
    priorUnknown:
      "A submission for this request was started from this browser but its result could not be verified: the payment may or may not have gone through. Check your MetaMask transaction history and ArcScan before sending again.",
    priorLocalOnly:
      "This record is kept only in this browser; it cannot know about a submission made from another device or a private tab.",
    estimating: "Estimating…",
    estimate: "Estimate the transaction",
    estimatedFee:
      "Estimated network fee (gas, charged separately and not deducted from the amount): {fee}",
    confirmCheckbox:
      "I have read the signed request above. I understand that the rate was fetched from CoinGecko and verified by the server, and that the amount to be sent is Arc Testnet test USDC.",
    confirmInWallet: "Confirm in wallet",
    reverifying: "Re-verifying the request and the rate…",
    waitingWallet: "Waiting for the transaction in your wallet…",
    sentAmount: "Payment sent ({amount} USDC).",
    sentNotice:
      "Sending again for the same request has been disabled on this page. The bill payer's page does not learn about this payment automatically; you need to tell them.",
    liveEstimating: "Estimating the transaction.",
    liveVerifying: "Re-verifying the request and the rate.",
    liveSending: "Waiting for the transaction in your wallet.",
    liveSent: "Payment sent.",
    footnotePrefix: "For test USDC, see ",
    footnoteMiddle: ", and for network setup, see ",
    footnoteSuffix:
      ". This link can technically be opened again; there is no server-side or on-chain record preventing the same debt from being paid twice.",
    reverifyFailed:
      "The wallet signature on the payment request can no longer be verified. Nothing was submitted.",
    differentRequest:
      "The request in the link is not the one you reviewed. Nothing was submitted; reload the page and review it again.",
    otherTabSending:
      "A submission for this request is in progress in another tab. It was stopped here so the same payment is not sent twice; check MetaMask and ArcScan.",
    alreadySucceeded:
      "This browser already has a record of a successful submission for this request. Check ArcScan before sending again.",
    unverifiedSubmission:
      "This browser has a submission for this request whose result was never verified. Check your MetaMask history and ArcScan before sending again.",
    askForNewLink: "Ask the person who created the request for a new link.",
  },

  errors: {
    receiptTooLargeToSend:
      "This image is too big to send. Try photographing the receipt from a little further away, in a single frame.",
    receiptUnreadableImage:
      "This image could not be opened. Try another photo, or a file in JPG or PNG format.",
    generic: "Something went wrong. Please try again.",
    analyzeFailed: "The receipt could not be analyzed. Please try again.",
    analyzeTimeout: "The analysis timed out. Please try again.",
    network: "The server could not be reached. Check your connection and try again.",
    rateService:
      "The rate service could not be reached. Check your connection and try again.",
    rateMalformed: "The rate service returned an unexpected response.",
    submissionUnavailable:
      "This browser does not provide the lock (Web Locks) or the verifiable local record needed to prevent the same payment from being sent twice. For safety, NOTHING was submitted. Try again in an up-to-date browser, in a non-private tab, with site data allowed.",
    unsafeAmount:
      "The amounts exceed the safe integer range, so an exact kuruş-level calculation is not possible. Check the amounts on the receipt.",
    indeterminateTotals:
      "It is unclear whether some charges are included in the item prices. Clarify this on the receipt screen before calculating the shares.",
    mismatchedTotals:
      "The item total does not match the grand total on the receipt. Correct the amounts on the receipt screen before calculating the shares.",
    allocationMismatch:
      "The distributed shares did not add up to the grand total on the receipt. Check the receipt amounts.",
    zeroChargeWeight:
      "A charge is applied separately while the item total is zero. There is no way to determine who to distribute this amount to.",
    zeroDiscountWeight:
      "A discount is applied while the distributable amount is zero. There is no way to determine who to deduct this amount from.",
    discountExceedsBalance:
      "The discount is larger than the distributable amount. Check the discount value on the receipt or how it is applied.",
    negativeParticipantShare:
      "One participant's share goes negative. Check the discount amount or the assignments.",

    conversion: {
      empty: "No rate entered.",
      invalid: "Enter a valid rate (e.g. 1 USDC = 34.25 TRY).",
      ambiguous:
        "It is unclear whether this notation uses a thousands separator or a decimal separator. Write the decimal part with 1, 2 or 4-6 digits.",
      tooManyDecimals: "The rate can have at most {max} decimal places.",
      tooLong:
        "The rate can be at most {maxLength} characters and {maxDigits} integer digits.",
      tooLarge: "The rate entered is outside a sensible range.",
      notPositive: "The rate must be greater than zero.",
    },

    paymentRequest: {
      notAnObject: "The payment request could not be read.",
      unexpectedField: "The payment request contains an unexpected field.",
      missingField: "The payment request is missing a field.",
      unsupportedSchemaVersion: "This payment request version is not supported.",
      outdatedSchemaVersion:
        "This link was created with an older version in which the rate was entered by hand. The rate is now verified by the server; ask the person who created the request for a new link.",
      invalidQuote:
        "The rate quote in the request is not valid. Do not trust this link; ask the sender for a new request.",
      requestOutlivesQuote:
        "The request is valid for longer than the rate quote it is based on. Do not trust this link.",
      invalidRequestId: "The request identifier is not valid.",
      invalidChainId: "The request was not created for Arc Testnet.",
      invalidRecipient: "The recipient address is not valid.",
      invalidDebtor: "The debtor address is not valid.",
      selfTransfer: "The sender and the recipient cannot be the same address.",
      invalidDebtKey: "The debt identifier is not valid.",
      invalidAmount: "The amount in the request is not valid.",
      inconsistentAmount:
        "The USDC amount in the request does not match the debt and the rate. Do not trust this link; ask the sender for a new request.",
      invalidRate: "The rate in the request is not valid.",
      invalidLabel: "The name field in the request is not valid.",
      invalidTimestamps: "The timing information on the request is not valid.",
      expired: "This payment request has expired.",
      notYetValid: "This payment request is not valid yet.",
      lifetimeTooLong: "The request is valid for longer than allowed.",
      invalidSignatureFormat: "The request signature is malformed.",
    },

    codec: {
      tooLong: "The payment request link is longer than expected.",
      malformedEncoding: "The payment request link is corrupt.",
      malformedJson: "The payment request contents could not be read.",
      duplicateKey: "The payment request contains a duplicate field.",
      invalidEnvelope: "The payment request structure is not in the expected format.",
    },

    requestSigning: {
      noProvider: "No wallet connection found. Connect your wallet again.",
      rejected: "The signature was rejected in the wallet.",
      noAccount: "No account is open in the wallet.",
      accountChanged:
        "The active account in the wallet is not the recipient of the request. Switch to the bill payer's account and try again.",
      networkChanged:
        "The wallet is not on Arc Testnet. Switch the network to Arc Testnet and try again.",
      invalidPayload:
        "The payment request did not pass our own validation; nothing was sent to the wallet. Check the amount, the rate and the addresses, then try again.",
      invalidRecipient: "The recipient wallet address is not valid.",
      signatureFormat: "The wallet did not return a signature in the expected format.",
      signerMismatch:
        "The signing account does not match the recipient of the request. The request was not created.",
      signFailed: "The payment request could not be signed. Please try again.",
    },

    send: {
      noProvider: "No wallet connection found. Connect your wallet again.",
      rejected: "The transaction was rejected in the wallet.",
      noAccount: "No account is open in the wallet. Open your wallet and connect again.",
      accountChanged:
        "The active account in the wallet is not the sender of the payment you confirmed. Switch to the correct account and try again.",
      networkChanged:
        "The wallet is not on Arc Testnet. Switch the network to Arc Testnet and try again.",
      invalidRecipient: "The recipient wallet address is not valid.",
      invalidSender: "The sender wallet address is not valid.",
      selfTransfer:
        "The sender and the recipient are the same wallet address. You cannot pay yourself.",
      invalidAmount: "The amount to send is not valid.",
      invalidRate: "The rate in the payment request is not valid.",
      inconsistentAmount:
        "The amount to send does not match the debt and the rate; nothing was submitted. Ask the person who created the request for a new link.",
      invalidRequestId: "The payment request identifier is not valid.",
      invalidRequestTime:
        "The validity information on the payment request is not valid; nothing was submitted. Ask the person who created the request for a new link.",
      expiredRequest:
        "This payment request expired; nothing was submitted. Ask the person who created the request for a new link.",
      invalidQuoteId: "The rate quote identifier in the payment request is not valid.",
      expiredQuote:
        "The rate quote the request is based on expired; nothing was submitted. Ask the person who created the request for a new link.",
      insufficientTimeRemaining:
        "The rate quote is about to expire; it could have expired before the transaction was confirmed. Nothing was submitted. Ask the person who created the request for a new link.",
      submissionUnknown:
        "The transaction WAS SENT to the wallet but its result could not be verified. DO NOT RETRY: the same payment could go out twice. First check your transaction history in MetaMask and on ArcScan; if the transaction does not appear, ask for a new link.",
      reverted:
        "The transaction reached the chain but FAILED (revert). No payment was made but gas may have been spent. Use the transaction link below to see the details on ArcScan; also check your MetaMask history before trying again.",
      insufficientFunds:
        "Insufficient balance or gas. Get test USDC from the Circle Faucet and try again.",
      estimateFailed:
        "The transaction could not be estimated. Check the network or the amount and try again.",
      sendFailed: "The transaction could not be sent. Please try again.",
    },

    sharedBill: {
      notAnObject: "The shared bill could not be read.",
      unexpectedField: "The shared bill contains an unexpected field.",
      missingField: "The shared bill is missing a field.",
      unsupportedSchemaVersion: "This shared bill version is not supported.",
      invalidBillId: "The shared bill identifier is not valid.",
      invalidChainId: "The shared bill was not created for Arc Testnet.",
      invalidRecipient: "The recipient address is not valid.",
      invalidLabel: "The name field is not valid.",
      invalidDebtor: "The debtor address is not valid.",
      selfTransfer: "The recipient cannot owe themselves.",
      duplicateDebtor: "The same debtor address cannot be used more than once.",
      duplicateDebtKey: "The same debt identifier cannot be used more than once.",
      invalidDebtKey: "The debt identifier is not valid.",
      invalidAmount: "The debt amount is not valid.",
      noDebts: "The shared bill contains no debt.",
      tooManyDebts: "The shared bill contains more debts than allowed.",
      debtCountMismatch: "The number of debts does not match the manifest.",
      commitmentMismatch:
        "The debt list does not match the signed commitment. Do not trust this bill.",
      invalidProof:
        "It could not be proven that the debt belongs to the signed root. Do not trust this bill.",
      legacyAggregateSchema:
        "This shared bill was created with a commitment format that is no longer supported. Ask the person who created the bill for a new link.",
      invalidTimestamps: "The timing information on the shared bill is not valid.",
      expired: "This shared bill has expired.",
      notYetValid: "This shared bill is not valid yet.",
      lifetimeTooLong: "The shared bill is valid for longer than allowed.",
      invalidSignatureFormat: "The shared bill signature is malformed.",
    },

    access: {
      notAnObject: "The access request could not be read.",
      unexpectedField: "The access request contains an unexpected field.",
      missingField: "The access request is missing a field.",
      unsupportedVersion: "This access request version is not supported.",
      invalidBillId: "The bill identifier is not valid.",
      invalidChainId: "The access request was not created for Arc Testnet.",
      invalidDebtor: "The wallet address is not valid.",
      invalidNonce: "The single-use value on the access request is not valid.",
      invalidAudience: "The audience of the access request is not valid.",
      audienceMismatch: "The access request was not created for this application.",
      invalidTimestamps: "The timing information on the access request is not valid.",
      expired: "The access request expired. Try again.",
      notYetValid: "The access request is not valid yet.",
      lifetimeTooLong: "The access request lives longer than allowed.",
      invalidSignatureFormat: "The signature is malformed.",
    },

    accessSigning: {
      noProvider: "No wallet connection found. Connect your wallet again.",
      rejected:
        "The signature was rejected in the wallet. You need to sign in order to see what you owe.",
      noAccount: "No account is open in the wallet.",
      accountChanged:
        "The active account in the wallet changed. Switch to the wallet of the debt you want to see and try again.",
      networkChanged:
        "The wallet is not on Arc Testnet. Switch the network to Arc Testnet and try again.",
      invalidChallenge:
        "The access request did not pass our own validation; nothing was sent to the wallet.",
      signatureFormat: "The wallet did not return a signature in the expected format.",
      signerMismatch:
        "The signing account does not match the address the request was made for.",
      signFailed: "Signing failed. Please try again.",
    },

    view: {
      malformedResponse:
        "The server returned an unexpected response. No debt is being shown.",
      invalidManifest:
        "The shared bill could not be verified or has expired. No debt is being shown.",
      invalidRecipientSignature:
        "The recipient signature on the bill could not be verified. Do not trust this link; no debt is being shown.",
      invalidProof:
        "It could not be proven that the debt belongs to the signed bill. No debt is being shown.",
      walletMismatch:
        "This debt does not belong to the connected wallet. Switch to the correct wallet and try again.",
      wrongChain: "The wallet is not on Arc Testnet. No debt is being shown.",
      notOpen: "This shared bill is no longer open.",
    },

    offer: {
      malformedResponse:
        "The server returned an unexpected payment offer. The payment was not opened.",
      walletMismatch:
        "The offer does not belong to the connected wallet. Switch to the correct wallet and try again.",
      recipientMismatch:
        "The recipient of the offer is not the recipient in the signed bill. Do not trust this offer; the payment was not opened.",
      amountMismatch:
        "The TRY amount of the offer does not match your verified debt. The payment was not opened.",
      inconsistentAmount:
        "The USDC amount of the offer does not match the value recomputed from the debt and the rate. The payment was not opened.",
      wrongChain: "The wallet is not on Arc Testnet. The payment was not opened.",
      expired: "The payment offer expired. Refresh the rate.",
      insufficientTime:
        "The rate quote is about to expire. Refresh the rate and try again.",
    },

    claim: {
      malformedResponse:
        "The server returned an unexpected reservation response. Nothing was submitted.",
      snapshotRejected:
        "The reservation did not pass our own validation; nothing was sent to the wallet.",
      changedFromReview:
        "The contents of the reservation are not identical to the payment you reviewed; NOTHING was submitted. Start over.",
    },

    billSigning: {
      noProvider: "No wallet connection found. Connect your wallet again.",
      rejected: "The signature was rejected in the wallet.",
      noAccount: "No account is open in the wallet.",
      accountChanged:
        "The active account in the wallet is not the recipient of the bill. Switch to the bill payer's account and try again.",
      networkChanged:
        "The wallet is not on Arc Testnet. Switch the network to Arc Testnet and try again.",
      invalidManifest:
        "The shared bill did not pass our own validation; nothing was sent to the wallet. Check the addresses and the amounts, then try again.",
      invalidRecipient: "The recipient wallet address is not valid.",
      signatureFormat: "The wallet did not return a signature in the expected format.",
      signerMismatch:
        "The signing account does not match the recipient of the bill. The shared bill was not created.",
      signFailed: "The shared bill could not be signed. Please try again.",
    },

    draft: {
      noDebts: "There is no debt to share.",
      tooManyDebts: "A bill can have at most {max} debtors.",
      invalidRecipient: "You need to connect the bill payer's wallet first.",
      missingAddress: "A wallet address must be entered for every debtor.",
      invalidAddress: "This wallet address is not valid.",
      duplicateAddress:
        "The same wallet address cannot be given to more than one participant.",
      recipientIsDebtor:
        "A debtor address cannot be the same as the bill payer's address.",
      invalidAmount: "The debt amount is not valid.",
    },

    quote: {
      notAnObject: "The rate quote could not be read.",
      unexpectedField: "The rate quote contains an unexpected field.",
      missingField: "The rate quote is missing a field.",
      unsupportedQuoteVersion: "This rate quote version is not supported.",
      invalidQuoteId: "The rate quote identifier is not valid.",
      invalidCurrencyPair: "The rate quote is not for the USDC/TRY pair.",
      invalidSource: "The source of the rate quote is not the expected provider.",
      invalidRate: "The rate value in the quote is not valid.",
      invalidTimestamps: "The timing information on the rate quote is not valid.",
      observationTooOld: "The rate data is out of date. Refresh the rate and try again.",
      observationInFuture: "The observation time of the rate quote appears to be in the future.",
      lifetimeTooLong: "The rate quote is valid for longer than allowed.",
      notYetValid: "The rate quote is not valid yet.",
      expired: "The rate quote expired. Refresh the rate and try again.",
      invalidTag: "The server signature on the rate quote could not be verified.",
    },

    participantName: {
      empty: "The name cannot be empty.",
      duplicate: "This name is already in the list.",
    },

    money: {
      empty: "Enter an amount.",
      invalid: "Enter a valid amount (e.g. 320.50).",
      tooManyDecimals: "You can enter at most two decimal places (e.g. 320.50).",
      negative: "The amount cannot be negative.",
    },

    assignments: {
      notEnoughParticipants: "At least {min} participants are needed to calculate shares.",
      invalidParticipantName: "Participant names cannot be empty and cannot repeat.",
      unknownPayer: "No bill payer is selected.",
      missingAssignment: "Some items are not assigned to anyone.",
      duplicateAssignment: "There is more than one assignment record for an item.",
      duplicateParticipantInAssignment:
        "The same participant is assigned more than once on one item.",
      unknownParticipant: "The assignments contain a participant that no longer exists.",
      unknownItem: "The assignments contain an item that no longer exists.",
      unassignedItem: "Some items are not assigned to anyone.",
      duplicateParticipantId:
        "The same identifier appears more than once in the participant list.",
    },

    receipt: {
      schema: "The receipt data is not valid. Check the amounts and correct them.",
      duplicateItemId:
        "The same item identifier appears more than once on the receipt. Check the items.",
    },

    api: {
      AUTH_REQUIRED: "Sign in with Google to use this operation.",
      SERVICE_UNAVAILABLE: "The service is unavailable right now. Please try again shortly.",
      SERVICE_NOT_CONFIGURED:
        "This feature is not configured on the server. Please try again shortly.",
      INTERNAL_ERROR: "An unexpected error occurred. Please try again.",
      NOT_AVAILABLE:
        "No debt could be found for this link. The link may be invalid or expired.",
      INVALID_REQUEST: "The request could not be read. Please try again.",
      INVALID_CONTENT_TYPE: "The request was not sent in the expected format.",
      INVALID_ENCODING: "The request body is not valid UTF-8.",
      BODY_TOO_LARGE: "The request body is too large.",
      BODY_READ_TIMEOUT: "The request body could not be read in time.",
      MALFORMED_JSON: "The request body could not be read.",
      INVALID_BODY: "The request body is not in the expected format.",
      DUPLICATE_FIELD: "The request body contains a duplicate field.",
      UNEXPECTED_FIELD: "The request body contains an unexpected field.",
      MISSING_FIELD: "The request body is missing a field.",
      INVALID_BILL_ID: "The bill identifier is not valid.",
      INVALID_ADDRESS: "The wallet address is not valid.",
      INVALID_SIGNATURE_FORMAT: "The signature is malformed.",
      INVALID_SIGNATURE:
        "The signature could not be verified. Make sure you signed with the connected wallet.",
      INVALID_CHALLENGE: "The access request could not be verified.",
      CHALLENGE_ALREADY_USED: "This access request has already been used. Try again.",
      NOT_AUTHENTICATED: "Sign in with your wallet first.",
      SESSION_EXPIRED: "Your session ended. Sign in with your wallet again.",
      INVALID_SHARED_BILL:
        "The signature on the shared bill could not be verified. The bill was not created.",
      BILL_ID_UNAVAILABLE: "This shared bill could not be created. Please try again.",
      STORAGE_REJECTED:
        "The shared bill could not be saved; the debt list was not accepted.",
      DEBT_NOT_CLAIMABLE:
        "This debt is not payable right now: it may already be paid, an attempt may be in progress on another device or tab, or the result of a previous attempt could not be verified. Check your wallet's transaction history and ArcScan before sending again.",
      OFFER_UNUSABLE:
        "The payment offer is no longer usable (expired or already used). Refresh the rate and try again.",
      ATTEMPT_ALREADY_ACTIVE:
        "A payment for this debt is already in progress (possibly on another device or tab). No new attempt was opened, so the same payment is not sent twice.",
      INCONSISTENT_OFFER:
        "The amount of the offer does not match the value recomputed from the debt and the rate; the payment was not started. Refresh the rate and try again.",
      INSUFFICIENT_TIME:
        "The rate quote or the link is about to expire; it could have expired during wallet confirmation. The payment was not started.",
      RATE_UNAVAILABLE:
        "The current USDC/TRY rate could not be fetched; the payment was not started. There is NO fallback to a hand-entered rate. Please try again shortly.",
      AMOUNT_UNAVAILABLE:
        "The USDC amount to pay could not be calculated safely; the payment was not started.",
      INVALID_OFFER_ID: "The payment offer identifier is not valid.",
      ATTEMPT_NOT_FOUND: "This payment attempt could not be found.",
      INVALID_ATTEMPT_ID: "The attempt identifier is not valid.",
      INVALID_TX_HASH: "The transaction hash is not valid.",
      TX_HASH_IN_USE:
        "This transaction hash belongs to another payment attempt. One transaction cannot settle two debts.",
      INVALID_TRANSITION:
        "This payment attempt is no longer at this step. Query the status again.",
      INVALID_OUTCOME: "The reported outcome is not recognised.",
      OUTCOME_HASH_CONFLICT:
        "An outcome reported as pre-broadcast cannot carry a transaction hash.",
      OUTCOME_HASH_REQUIRED:
        "An outcome reported as submitted requires a transaction hash.",
      MISSING_FILE: "No receipt image was found.",
      EMPTY_FILE: "The file looks empty. Please try another image.",
      FILE_TOO_LARGE: "The image is too large. You can upload up to 10 MB.",
      ACCOUNT_DELETED:
        "This account has been deleted. Sign in again to continue.",
      DAILY_LIMIT_REACHED:
        "You have used up today's analyses. You can try again tomorrow.",
      SERVICE_BUSY:
        "The total analysis limit for today has been reached. This is not about your own allowance; try again tomorrow.",
      UNSUPPORTED_FILE_TYPE: "Only JPG, PNG and WEBP files are supported.",
      MODEL_REFUSED:
        "This image could not be analyzed. Please try a clear, complete photo of the receipt.",
      RECEIPT_NOT_READABLE:
        "The items on the receipt could not be read. Try a sharper, well-lit photo that shows the whole receipt.",
      INVALID_RECEIPT_DATA:
        "The receipt data could not be read in the expected format. Please try again.",
      ANALYSIS_TIMEOUT:
        "The analysis timed out. Please try again; if the problem persists, try a smaller image.",
      ANALYSIS_FAILED:
        "The analysis service is unreachable right now. Please try again shortly.",
      INVALID_TAG_FORMAT: "The server signature on the rate quote could not be verified.",
    },
  },

  plurals: {
    sharedBetween: {
      one: "Split equally between {count} participant.",
      other: "Split equally between {count} participants.",
    },
    itemsUnassigned: {
      one: "{count} item is not assigned to anyone yet. Assign every item to at least one participant.",
      other:
        "{count} items are not assigned to anyone yet. Assign every item to at least one participant.",
    },
    needParticipants: {
      one: "At least {count} participant is needed to continue.",
      other: "At least {count} participants are needed to continue.",
    },
    allAssigned: {
      one: "Every item is assigned. You can continue with {count} or more participants.",
      other: "Every item is assigned. You can continue with {count} or more participants.",
    },
    billDebtorsPaid: {
      one: "{paid} of {count} debtor paid",
      other: "{paid} of {count} debtors paid",
    },
  },
};
