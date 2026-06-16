## TODO PLAN

Spawn separate sub process to do the following.

1. PLAN. Create a dedicated planning directory. I want to be able to modify the lan and feed to claude.

2. Plan a RAG based AI system with multi shots. Like we have in SVTC. The AI system should have context of the tab being used. Also i would like to have the option of running a web-llm and build the prompt databases so we dont have to send data outside the organization.

3. Plan to modularize the code. Deep dive for stale code, debug for failire, edge cases etc. Reduce file sizes.

4. PLAN THIS: We need to have the nav menu on the right properly structured. 

5. PLAN THIS: In the sketch. we need to have the option of repeat

6. http://localhost:3333/design. Need to make a proper graph of the architecture and navigatioj for this app. Use svelteflow.

7. PLAN THIS: In the repeat card we need to enhance it what i would want is the abilty to open it in its own windowwithin the tab like we do for sketch, show the params ont he top.. along with the iterators.. and then have two tabs in there one for editing inside the "Loop and " one for using the graphical modifiers. 


8. PLAN Right now we are baking everything in the server. Would it be better to serve only the code load that and execute in the client? We could do this for both the manifold and the occt.
Since the server is creating a translater from the json to the script anyway, there is some protection in the graph to script logic that should be quick. But we will use the client horsepower to execute? However I want one option. I want to preserve the SERVER BREP and PART builder to be used int he future undere the api directory. Call it server builder. Don't throw it.

9. Prune the scripts directory with whatever is not relevant. Also the tests directory. 

10. Consolidate the ai direcvtory and trining_data. 

11. Also do we need the FEM, forge, directories.. 

12. Now for the move/rotate. I think this is better addressed as a TXFMN transformation card on its own and attached to a part.. with a node.. The TXfmn card will just be a table with rows being added  x,y,z generally or rx,ry, rz. and each row will have these rows with sockets to the right.  It will be compact.  
the structure willbe 
TXFMN  
______________
ROT 
RX
RY
RZ
______________
MV 
X
Y
Z
______________

https://www.scratchapixel.com/lessons/3d-basic-rendering/introduction-to-shading/shading-lights.html
https://www.scratchapixel.com/lessons/3d-basic-rendering/introduction-to-shading/shading-normals.html


PARKED. 
1. We need to build a parametric casing visualizaiton. Here basically we will have a function thst will determine the number of columns.
2. By default new revolve, extrude parts should use sketch not the polygon.
3. The autolayout is not working well. The params and the properties card should never overlap with any other card. We need to mae them repel all other cards.

