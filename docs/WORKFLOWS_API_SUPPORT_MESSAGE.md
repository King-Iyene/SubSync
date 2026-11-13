# Message to HighLevel developer support (send from the developer portal support form or the developer community)

Subject: Please enable the Workflows API (create and publish) for our marketplace app and one test location

Hello,

We build a marketplace app called SubSync (App ID: <APP ID FROM THE PORTAL, 6ae2a79309eaa881c1eb419e>). We would like the Workflows API to be enabled for this app and for this test location: <LOCATION ID OF KD SQUARES TEST>. Today our test calls return 403 WORKFLOW_API_NOT_ENABLED_FOR_LOCATION.

What we use it for: creating ONE internal "Call queue" workflow in each client account that installs our app, so the business does not have to build it by hand. The workflow has three steps: a contact gets a tag, a Manual Action (call task) is created for a team member, and the tag is removed. It sends nothing to contacts: no SMS, email or calls. We never edit, rename or delete a workflow a customer already has, and we create it only once per account (we check by stored id and by exact name first).

Endpoints we call (Version: v3, scopes workflows.readonly and workflows.write, both optional in our listing):
- Get Step Types (to read the real trigger and action type ids)
- Validate Workflow Definition (before creating anything)
- Search / list workflows (to avoid duplicates)
- Create Workflow (POST /workflows/ with locationId, folder created if missing)
- Update Workflow Status (publish, as a separate call)
- Delete Workflow, only in our own test script, and only for a throwaway draft that script created

Could you please tell us (1) whether the Workflows API can be enabled for the app and the location above, (2) whether enabling is per location or per app, so installs made later by other agencies and businesses work without a separate request, and (3) whether publishing needs workflows.write or a separate scope.

Thank you,
<NAME>, <EMAIL>
